import SwaggerParser from "@apidevtools/swagger-parser";
import { OpenAPIV3 } from "openapi-types";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VALID_DOMAINS,
  type CompactEndpoint,
  type Domain,
  type EndpointParameter,
  type FullEndpoint,
} from "../domain/index.js";
import { normalizeSchema } from "./schema-normalizer.js";

const SPEC_BASE_URL =
  "https://raw.githubusercontent.com/RocketChat/Rocket.Chat-Open-API/main";
const AUTH_HEADER_NAMES = new Set(["X-Auth-Token", "X-User-Id"]);
const specCache = new Map<Domain, OpenAPIV3.Document>();
const operationDomainIndex = new Map<string, Domain>();
const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, "..", "..", ".cache");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function getSpecUrl(domain: Domain): string {
  return `${SPEC_BASE_URL}/${domain}.yaml`;
}

function readDiskCache(domain: Domain): OpenAPIV3.Document | null {
  const cachePath = join(CACHE_DIR, `${domain}.json`);
  if (!existsSync(cachePath)) {
    return null;
  }

  const age = Date.now() - statSync(cachePath).mtimeMs;
  if (age > CACHE_TTL_MS) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(cachePath, "utf-8")) as OpenAPIV3.Document;
  } catch {
    return null;
  }
}

function writeDiskCache(domain: Domain, document: OpenAPIV3.Document): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(
      join(CACHE_DIR, `${domain}.json`),
      JSON.stringify(document),
      "utf-8",
    );
  } catch {
    // Disk cache is best-effort only.
  }
}

async function getDomainSpec(domain: Domain): Promise<OpenAPIV3.Document> {
  const memCached = specCache.get(domain);
  if (memCached) {
    return memCached;
  }

  const diskCached = readDiskCache(domain);
  if (diskCached) {
    specCache.set(domain, diskCached);
    return diskCached;
  }

  const url = getSpecUrl(domain);
  try {
    const document = (await SwaggerParser.dereference(url)) as OpenAPIV3.Document;
    specCache.set(domain, document);
    writeDiskCache(domain, document);
    return document;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to fetch Rocket.Chat OpenAPI spec for "${domain}" from ${url}: ${message}`,
    );
  }
}

function sanitizeOperationId(
  raw: string | undefined,
  method: string,
  path: string,
): string {
  const base = raw ?? `${method}_${path.replace(/[^a-zA-Z0-9]/g, "_")}`;
  return base.replace(/\./g, "_").replace(/[^a-z0-9_-]/gi, "_");
}

function deduplicateId(id: string, usedIds: Set<string>): string {
  if (!usedIds.has(id)) {
    usedIds.add(id);
    return id;
  }

  let index = 1;
  while (usedIds.has(`${id}_${index}`)) {
    index += 1;
  }
  const uniqueId = `${id}_${index}`;
  usedIds.add(uniqueId);
  return uniqueId;
}

function mergeParameters(
  pathParameters?: OpenAPIV3.ParameterObject[],
  operationParameters?: OpenAPIV3.ParameterObject[],
): OpenAPIV3.ParameterObject[] {
  const merged: OpenAPIV3.ParameterObject[] = [];

  for (const parameter of [...(pathParameters ?? []), ...(operationParameters ?? [])]) {
    const existingIndex = merged.findIndex(
      (candidate) =>
        candidate.name === parameter.name && candidate.in === parameter.in,
    );
    if (existingIndex >= 0) {
      merged[existingIndex] = parameter;
    } else {
      merged.push(parameter);
    }
  }

  return merged;
}

function toEndpointParameter(
  parameter: OpenAPIV3.ParameterObject,
): EndpointParameter {
  return {
    name: parameter.name,
    in: parameter.in as EndpointParameter["in"],
    required: parameter.required ?? false,
    description: parameter.description,
    schema: parameter.schema
      ? normalizeSchema(parameter.schema as OpenAPIV3.SchemaObject)
      : undefined,
  };
}

function buildInputSchema(
  parameters: EndpointParameter[],
  requestBody?: FullEndpoint["requestBody"],
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const parameter of parameters) {
    if (parameter.in === "header" && AUTH_HEADER_NAMES.has(parameter.name)) {
      continue;
    }
    properties[parameter.name] = parameter.schema ?? { type: "string" };
    if (parameter.required) {
      required.push(parameter.name);
    }
  }

  if (requestBody) {
    properties.requestBody = requestBody.schema;
    if (requestBody.required) {
      required.push("requestBody");
    }
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

function extractCompactEndpoints(
  document: OpenAPIV3.Document,
  domain: Domain,
): CompactEndpoint[] {
  const results: CompactEndpoint[] = [];
  const usedIds = new Set<string>();

  if (!document.paths) {
    return results;
  }

  for (const [path, pathItem] of Object.entries(document.paths)) {
    if (!pathItem) {
      continue;
    }

    for (const method of Object.values(OpenAPIV3.HttpMethods)) {
      const operation = (pathItem as Record<string, unknown>)[method] as
        | OpenAPIV3.OperationObject
        | undefined;
      if (!operation) {
        continue;
      }

      const operationId = deduplicateId(
        sanitizeOperationId(operation.operationId, method, path),
        usedIds,
      );
      results.push({
        operationId,
        method: method.toUpperCase(),
        path,
        summary:
          operation.summary ??
          operation.description?.slice(0, 80) ??
          `${method.toUpperCase()} ${path}`,
        domain,
        tag: operation.tags?.[0] ?? "Other",
      });
      operationDomainIndex.set(operationId, domain);
    }
  }

  return results;
}

function extractFullEndpoints(
  document: OpenAPIV3.Document,
  domain: Domain,
  requestedIds?: Set<string>,
): FullEndpoint[] {
  const results: FullEndpoint[] = [];
  const usedIds = new Set<string>();
  const globalSecurity = document.security ?? [];

  if (!document.paths) {
    return results;
  }

  for (const [path, pathItem] of Object.entries(document.paths)) {
    if (!pathItem) {
      continue;
    }

    for (const method of Object.values(OpenAPIV3.HttpMethods)) {
      const operation = (pathItem as Record<string, unknown>)[method] as
        | OpenAPIV3.OperationObject
        | undefined;
      if (!operation) {
        continue;
      }

      const operationId = deduplicateId(
        sanitizeOperationId(operation.operationId, method, path),
        usedIds,
      );
      if (requestedIds && !requestedIds.has(operationId)) {
        continue;
      }

      const mergedParameters = mergeParameters(
        pathItem.parameters as OpenAPIV3.ParameterObject[] | undefined,
        operation.parameters as OpenAPIV3.ParameterObject[] | undefined,
      ).map(toEndpointParameter);

      let requestBody: FullEndpoint["requestBody"];
      if (operation.requestBody) {
        const request = operation.requestBody as OpenAPIV3.RequestBodyObject;
        const jsonContent = request.content?.["application/json"];
        if (jsonContent?.schema) {
          requestBody = {
            contentType: "application/json",
            required: request.required ?? false,
            schema: normalizeSchema(
              jsonContent.schema as
                | OpenAPIV3.SchemaObject
                | OpenAPIV3.ReferenceObject,
            ),
          };
        }
      }

      results.push({
        operationId,
        method: method.toUpperCase(),
        path,
        summary:
          operation.summary ??
          operation.description?.slice(0, 80) ??
          `${method.toUpperCase()} ${path}`,
        description: operation.description ?? operation.summary ?? path,
        domain,
        tag: operation.tags?.[0] ?? "Other",
        parameters: mergedParameters,
        requestBody,
        security:
          operation.security === undefined
            ? globalSecurity
            : operation.security ?? [],
        inputSchema: buildInputSchema(mergedParameters, requestBody),
      });
    }
  }

  return results;
}

export function getAvailableDomains(): Domain[] {
  return [...VALID_DOMAINS];
}

export async function discoverEndpoints(
  domains: Domain[],
): Promise<CompactEndpoint[]> {
  const specs = await Promise.all(domains.map((domain) => getDomainSpec(domain)));
  return specs.flatMap((document, index) =>
    extractCompactEndpoints(document, domains[index]!),
  );
}

export async function getEndpointsByIds(
  operationIds: string[],
): Promise<FullEndpoint[]> {
  const requestedIds = new Set(operationIds);
  const indexedDomains = new Set<Domain>();
  let hasUnknown = false;

  for (const operationId of operationIds) {
    const domain = operationDomainIndex.get(operationId);
    if (domain) {
      indexedDomains.add(domain);
    } else {
      hasUnknown = true;
    }
  }

  const domainsToSearch =
    indexedDomains.size > 0 && !hasUnknown ? [...indexedDomains] : VALID_DOMAINS;
  const specs = await Promise.all(
    domainsToSearch.map((domain) => getDomainSpec(domain)),
  );

  return specs.flatMap((document, index) =>
    extractFullEndpoints(document, domainsToSearch[index]!, requestedIds),
  );
}

export async function getSpecStats(): Promise<{
  totalEndpoints: number;
  totalSchemaBytes: number;
}> {
  const specs = await Promise.all(VALID_DOMAINS.map((domain) => getDomainSpec(domain)));
  const allEndpoints = specs.flatMap((document, index) =>
    extractCompactEndpoints(document, VALID_DOMAINS[index]!),
  );
  const totalSchemaBytes = specs.reduce(
    (sum, document) => sum + JSON.stringify(document).length,
    0,
  );

  return {
    totalEndpoints: allEndpoints.length,
    totalSchemaBytes,
  };
}
