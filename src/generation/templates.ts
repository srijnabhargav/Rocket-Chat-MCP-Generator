import {
  endpointRequiresAuth,
  type FullEndpoint,
  type OutputMode,
  type WorkflowInputMapping,
} from "../domain/index.js";

function esc(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");
}

const AUTH_HEADERS = new Set(["X-Auth-Token", "X-User-Id"]);

function buildToolHandler(endpoint: FullEndpoint): string {
  const lines: string[] = [];
  const method = endpoint.method.toUpperCase();
  const pathParameters = endpoint.parameters.filter(
    (parameter) => parameter.in === "path",
  );

  if (pathParameters.length > 0) {
    lines.push(`    let resolvedPath = "${esc(endpoint.path)}";`);
    for (const parameter of pathParameters) {
      lines.push(
        `    resolvedPath = resolvedPath.replace("{${parameter.name}}", encodeURIComponent(String(args["${parameter.name}"])));`,
      );
    }
  } else {
    lines.push(`    const resolvedPath = "${esc(endpoint.path)}";`);
  }

  const queryParameters = endpoint.parameters.filter(
    (parameter) => parameter.in === "query",
  );
  if (queryParameters.length > 0) {
    lines.push(`    const query = new URLSearchParams();`);
    for (const parameter of queryParameters) {
      lines.push(
        `    if (args["${parameter.name}"] !== undefined) query.set("${parameter.name}", String(args["${parameter.name}"]));`,
      );
    }
    lines.push(`    const qs = query.toString();`);
    lines.push(`    const fullPath = qs ? \`\${resolvedPath}?\${qs}\` : resolvedPath;`);
  } else {
    lines.push(`    const fullPath = resolvedPath;`);
  }

  const headerParameters = endpoint.parameters.filter(
    (parameter) =>
      parameter.in === "header" && !AUTH_HEADERS.has(parameter.name),
  );
  const options: string[] = [];

  if (endpointRequiresAuth(endpoint)) {
    options.push("auth: true");
  }
  if (endpoint.requestBody) {
    options.push('body: args["requestBody"]');
  }
  if (headerParameters.length > 0) {
    lines.push(`    const extraHeaders: Record<string, string> = {};`);
    for (const parameter of headerParameters) {
      lines.push(
        `    if (args["${parameter.name}"] !== undefined) extraHeaders["${parameter.name}"] = String(args["${parameter.name}"]);`,
      );
    }
    options.push("headers: extraHeaders");
  }

  const optionsString = options.length > 0 ? `, { ${options.join(", ")} }` : "";

  if (endpoint.operationId === "post-api-v1-login") {
    lines.push(`    const result = await client.request("${method}", fullPath${optionsString});`);
    lines.push(`    if (!result.isError) {`);
    lines.push(`      try {`);
    lines.push(`        const data = JSON.parse(result.content[0].text);`);
    lines.push(`        if (data.data?.authToken && data.data?.userId) {`);
    lines.push(`          client.setAuth(data.data.authToken, data.data.userId);`);
    lines.push(`        }`);
    lines.push(`      } catch {`);
    lines.push(`        // Leave auth unchanged if the response could not be parsed.`);
    lines.push(`      }`);
    lines.push(`    }`);
    lines.push(`    return result;`);
  } else {
    lines.push(`    return client.request("${method}", fullPath${optionsString});`);
  }

  return lines.join("\n");
}

export function generateRcClient(): string {
  return `const config = {
  baseUrl: process.env.ROCKETCHAT_URL || "http://localhost:3000",
  authToken: process.env.ROCKETCHAT_AUTH_TOKEN || "",
  userId: process.env.ROCKETCHAT_USER_ID || "",
};

export type ToolResult = {
  content: { type: string; text: string }[];
  isError?: boolean;
};

let initialized = false;

export async function initAuth(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const user = process.env.ROCKETCHAT_USER || "";
  const password = process.env.ROCKETCHAT_PASSWORD || "";

  if (user && password) {
    const response = await fetch(\`\${config.baseUrl}/api/v1/login\`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user, password }),
    });
    const data = await response.json();
    if (!response.ok || !data.data?.authToken) {
      console.error("Login failed:", JSON.stringify(data));
      process.exit(1);
    }
    config.authToken = data.data.authToken;
    config.userId = data.data.userId;
    console.error(\`Authenticated as \${user}\`);
    return;
  }

  if (config.authToken && config.userId) {
    console.error("Using pre-existing auth tokens.");
    return;
  }

  console.error("No Rocket.Chat credentials found. Copy .env.example to .env and configure credentials.");
  process.exit(1);
}

class RocketChatClient {
  setAuth(token: string, userId: string): void {
    config.authToken = token;
    config.userId = userId;
  }

  async request(
    method: string,
    path: string,
    options: { auth?: boolean; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<ToolResult> {
    const url = \`\${config.baseUrl}\${path}\`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...options.headers,
    };

    if (options.auth) {
      headers["X-Auth-Token"] = config.authToken;
      headers["X-User-Id"] = config.userId;
    }

    const fetchOptions: RequestInit = { method, headers };
    if (options.body !== undefined) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, fetchOptions);
    const data = await response.json();

    if (!response.ok) {
      return {
        content: [{ type: "text", text: \`API error \${response.status}: \${JSON.stringify(data)}\` }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
}

export const client = new RocketChatClient();
`;
}

export interface GeneratedToolDescriptor {
  fileName: string;
  toolName: string;
  description: string;
  method: string;
  path: string;
}

export interface WorkflowToolSource {
  fileName: string;
  toolName: string;
  description: string;
  steps: GeneratedWorkflowStepSource[];
}

export interface GeneratedWorkflowStepSource {
  id: string;
  endpoint: FullEndpoint;
  inputMappings: WorkflowInputMapping[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function removeRequiredPath(
  schema: Record<string, unknown>,
  pathSegments: string[],
): void {
  if (pathSegments.length === 0) {
    return;
  }

  const [head, ...rest] = pathSegments;
  const required = Array.isArray(schema.required)
    ? schema.required.filter((entry) => entry !== head)
    : undefined;
  if (required) {
    schema.required = required;
  }

  if (rest.length === 0) {
    return;
  }

  const properties = schema.properties;
  if (!isRecord(properties)) {
    return;
  }

  const nextSchema = properties[head];
  if (!isRecord(nextSchema)) {
    return;
  }

  removeRequiredPath(nextSchema, rest);
}

function sampleValueForSchema(schema: Record<string, unknown>): unknown {
  const type = schema.type;

  switch (type) {
    case "string":
      return "test-value";
    case "number":
    case "integer":
      return 1;
    case "boolean":
      return true;
    case "array": {
      const items = schema.items;
      return isRecord(items) ? [sampleValueForSchema(items)] : ["test-value"];
    }
    case "object": {
      const properties = schema.properties;
      if (!isRecord(properties)) {
        return {};
      }
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(properties)) {
        if (isRecord(value)) {
          result[key] = sampleValueForSchema(value);
        }
      }
      return result;
    }
    default:
      return "test-value";
  }
}

function deleteNestedPath(
  value: Record<string, unknown>,
  pathSegments: string[],
): void {
  if (pathSegments.length === 0) {
    return;
  }

  const [head, ...rest] = pathSegments;
  if (rest.length === 0) {
    delete value[head];
    return;
  }

  const nextValue = value[head];
  if (!isRecord(nextValue)) {
    return;
  }

  deleteNestedPath(nextValue, rest);
}

function buildWorkflowStepSchema(step: GeneratedWorkflowStepSource): string {
  const stepSchema = cloneJson(step.endpoint.inputSchema);
  for (const mapping of step.inputMappings) {
    removeRequiredPath(stepSchema, mapping.targetPath.split("."));
  }
  const mappingDescription =
    step.inputMappings.length > 0
      ? ` Auto-populated fields: ${step.inputMappings
          .map(
            (mapping) =>
              `${mapping.targetPath} <= ${mapping.sourceStepId}.${mapping.sourcePath}`,
          )
          .join(", ")}.`
      : "";
  stepSchema.description = `${step.endpoint.summary || step.endpoint.description}.${mappingDescription}`.trim();

  return JSON.stringify(stepSchema, null, 2)
    .split("\n")
    .map((line, index) => (index === 0 ? line : `    ${line}`))
    .join("\n");
}

function buildWorkflowSampleArgs(
  step: GeneratedWorkflowStepSource,
): Record<string, unknown> {
  const mappedTargets = new Set(
    step.inputMappings.map((mapping) => mapping.targetPath),
  );
  const sampleArgs: Record<string, unknown> = {};

  for (const parameter of step.endpoint.parameters) {
    if (
      (parameter.in === "path" || parameter.in === "query") &&
      !mappedTargets.has(parameter.name)
    ) {
      sampleArgs[parameter.name] = "test-value";
    }
  }

  if (step.endpoint.requestBody) {
    const requestBody = sampleValueForSchema(
      step.endpoint.requestBody.schema,
    ) as Record<string, unknown>;
    for (const mapping of step.inputMappings) {
      const pathSegments = mapping.targetPath.split(".");
      if (pathSegments[0] === "requestBody") {
        deleteNestedPath(requestBody, pathSegments.slice(1));
      }
    }
    sampleArgs.requestBody = requestBody;
  }

  return sampleArgs;
}

export function generateToolFile(endpoint: FullEndpoint): string {
  const schema = JSON.stringify(endpoint.inputSchema, null, 2)
    .split("\n")
    .map((line, index) => (index === 0 ? line : `  ${line}`))
    .join("\n");

  return `import { client } from "../rc-client.js";
import type { ToolDefinition } from "./index.js";

export const tool: ToolDefinition = {
  name: "${endpoint.operationId}",
  description: \`${esc(endpoint.summary || endpoint.description)}\`,
  inputSchema: ${schema},
  handler: async (args) => {
${buildToolHandler(endpoint)}
  },
};
`;
}

export function generateWorkflowToolFile(workflow: WorkflowToolSource): string {
  const imports = workflow.steps.map(
    (step, index) =>
      `import { tool as stepTool${index} } from "./${step.endpoint.operationId}.js";`,
  );
  const nestedProperties = workflow.steps
    .map((step) => {
      const schema = buildWorkflowStepSchema(step);
      return `    "${step.id}": ${schema}`;
    })
    .join(",\n");

  const handlerLines: string[] = [
    `    const workflowArgs = args as Record<string, unknown>;`,
    `    const results: Record<string, unknown> = {};`,
    `    const parsedResults: Record<string, unknown> = {};`,
  ];

  workflow.steps.forEach((step, index) => {
    handlerLines.push(
      `    const stepArgs${index} = cloneArgs(workflowArgs["${step.id}"] as Record<string, unknown> | undefined);`,
    );
    for (const [mappingIndex, mapping] of step.inputMappings.entries()) {
      const varName = `mappedValue${index}_${mappingIndex}_${mapping.targetPath.replace(/[^a-zA-Z0-9]/g, "_")}`;
      handlerLines.push(
        `    const ${varName} = getValueAtPath(parsedResults["${mapping.sourceStepId}"], "${mapping.sourcePath}");`,
      );
      handlerLines.push(
        `    if (${varName} === undefined) {`,
      );
      handlerLines.push(`      return {`);
      handlerLines.push(
        `        content: [{ type: "text", text: JSON.stringify({ failedStep: "${step.id}", missingMapping: "${mapping.sourceStepId}.${mapping.sourcePath}", targetPath: "${mapping.targetPath}", results }, null, 2) }],`,
      );
      handlerLines.push(`        isError: true,`);
      handlerLines.push(`      };`);
      handlerLines.push(`    }`);
      handlerLines.push(
        `    setValueAtPath(stepArgs${index}, "${mapping.targetPath}", ${varName});`,
      );
    }
    handlerLines.push(
      `    const stepResult${index} = await stepTool${index}.handler(stepArgs${index});`,
    );
    handlerLines.push(`    results["${step.id}"] = stepResult${index};`);
    handlerLines.push(`    if (stepResult${index}.isError) {`);
    handlerLines.push(`      return {`);
    handlerLines.push(
      `        content: [{ type: "text", text: JSON.stringify({ failedStep: "${step.id}", results }, null, 2) }],`,
    );
    handlerLines.push(`        isError: true,`);
    handlerLines.push(`      };`);
    handlerLines.push(`    }`);
    handlerLines.push(
      `    parsedResults["${step.id}"] = parseStepResult(stepResult${index});`,
    );
  });
  handlerLines.push(
    `    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };`,
  );

  return `import type { ToolResult } from "../rc-client.js";
import type { ToolDefinition } from "./index.js";
${imports.join("\n")}

function cloneArgs(args: Record<string, unknown> | undefined): Record<string, unknown> {
  return args ? JSON.parse(JSON.stringify(args)) : {};
}

function parseStepResult(result: ToolResult): unknown {
  const firstContent = result.content[0]?.text;
  if (!firstContent) {
    return undefined;
  }
  try {
    return JSON.parse(firstContent);
  } catch {
    return firstContent;
  }
}

function getValueAtPath(source: unknown, path: string): unknown {
  if (!path) {
    return source;
  }

  let current: unknown = source;
  for (const segment of path.split(".")) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function setValueAtPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".");
  let current: Record<string, unknown> = target;

  for (const segment of segments.slice(0, -1)) {
    const nextValue = current[segment];
    if (typeof nextValue !== "object" || nextValue === null) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }

  const finalSegment = segments[segments.length - 1];
  current[finalSegment] = value;
}

export const tool: ToolDefinition = {
  name: "${workflow.toolName}",
  description: \`${esc(workflow.description)}\`,
  inputSchema: {
    "type": "object",
    "properties": {
${nestedProperties}
    }
  },
  handler: async (args) => {
${handlerLines.join("\n")}
  },
};
`;
}

export function generateToolIndex(tools: GeneratedToolDescriptor[]): string {
  const imports = tools.map(
    (tool, index) =>
      `import { tool as tool${index} } from "./${tool.fileName}.js";`,
  );
  const toolRefs = tools.map((_, index) => `  tool${index},`);

  return `import type { ToolResult } from "../rc-client.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

${imports.join("\n")}

export const tools: ToolDefinition[] = [
${toolRefs.join("\n")}
];
`;
}

export function generateServerEntry(
  serverName: string,
  toolCount: number,
): string {
  return `#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { initAuth } from "./rc-client.js";
import { tools } from "./tools/index.js";

const server = new Server(
  { name: "${esc(serverName)}", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  const tool = tools.find((candidate) => candidate.name === name);

  if (!tool) {
    return {
      content: [{ type: "text", text: \`Unknown tool: \${name}\` }],
      isError: true,
    };
  }

  try {
    return await tool.handler(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: \`Error: \${message}\` }],
      isError: true,
    };
  }
});

async function main() {
  await initAuth();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("${esc(serverName)} running on stdio with ${toolCount} tools");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
`;
}

export function generateGeneratedPackageJson(serverName: string): string {
  return JSON.stringify(
    {
      name: serverName,
      version: "1.0.0",
      type: "module",
      scripts: {
        start: "node --env-file=.env --import tsx src/server.ts",
        build: "tsc",
        "start:built": "node dist/server.js",
        test: "tsx --test src/tests/*.test.ts",
      },
      dependencies: {
        "@modelcontextprotocol/sdk": "^1.27.1",
      },
      devDependencies: {
        "@types/node": "^25.3.3",
        tsx: "^4.21.0",
        typescript: "^5.9.3",
      },
    },
    null,
    2,
  ) + "\n";
}

export function generateGeneratedTsConfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "Node16",
        moduleResolution: "Node16",
        outDir: "./dist",
        rootDir: "./src",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
      },
      include: ["src"],
    },
    null,
    2,
  ) + "\n";
}

export function generateEnvExample(): string {
  return `ROCKETCHAT_URL=http://localhost:3000
ROCKETCHAT_USER=your-username
ROCKETCHAT_PASSWORD=your-password

# Or use pre-existing tokens instead.
# ROCKETCHAT_AUTH_TOKEN=your-token
# ROCKETCHAT_USER_ID=your-user-id
`;
}

export function generateReadme(
  serverName: string,
  tools: GeneratedToolDescriptor[],
): string {
  const rows = tools
    .map(
      (tool) =>
        `| \`${tool.toolName}\` | \`${tool.method}\` | \`${tool.path}\` | ${tool.description} |`,
    )
    .join("\n");

  return `# ${serverName}

A minimal Rocket.Chat MCP server generated by \`rocket-chat-mcp-generator\`.

## Tools

| Tool | Method | Path | Summary |
| --- | --- | --- | --- |
${rows}

## Quick Start

\`\`\`bash
npm install
cp .env.example .env
npm start
\`\`\`
`;
}

export function generateTestSetup(): string {
  return `import { mock } from "node:test";
import { tools, type ToolDefinition } from "../tools/index.js";

export const ctx: {
  tools: ToolDefinition[];
  lastFetchUrl: string;
  lastFetchOptions: RequestInit;
  fetchHistory: Array<{ url: string; options: RequestInit }>;
  queuedResponses: Array<{ body: unknown; status: number }>;
  mockFetch: ReturnType<typeof mock.fn>;
} = {
  tools,
  lastFetchUrl: "",
  lastFetchOptions: {},
  fetchHistory: [],
  queuedResponses: [],
  mockFetch: mock.fn(async (url: string | URL | Request, init?: RequestInit) => {
    ctx.lastFetchUrl = String(url);
    ctx.lastFetchOptions = init || {};
    ctx.fetchHistory.push({ url: String(url), options: init || {} });
    const nextResponse = ctx.queuedResponses.shift() ?? {
      body: { success: true },
      status: 200,
    };
    return new Response(JSON.stringify(nextResponse.body), {
      status: nextResponse.status,
      headers: { "Content-Type": "application/json" },
    });
  }),
};

let initialized = false;

export async function init(): Promise<void> {
  if (initialized) return;
  initialized = true;
  process.env.ROCKETCHAT_URL = "http://localhost:3000";
  process.env.ROCKETCHAT_AUTH_TOKEN = "test-token";
  process.env.ROCKETCHAT_USER_ID = "test-user-id";
  (globalThis as { fetch: typeof fetch }).fetch =
    ctx.mockFetch as unknown as typeof fetch;
}

export function queueResponse(body: unknown, status = 200): void {
  ctx.queuedResponses.push({ body, status });
}

export function reset(): void {
  ctx.lastFetchUrl = "";
  ctx.lastFetchOptions = {};
  ctx.fetchHistory = [];
  ctx.queuedResponses = [];
  ctx.mockFetch.mock.resetCalls();
}
`;
}

export function generateToolTest(endpoint: FullEndpoint): string {
  const sampleArgs: Record<string, unknown> = {};

  for (const parameter of endpoint.parameters) {
    if (parameter.in === "path" || parameter.in === "query") {
      sampleArgs[parameter.name] = "test-value";
    }
  }
  if (endpoint.requestBody) {
    sampleArgs.requestBody = { test: "value" };
  }

  return `import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { ctx, init, reset } from "./setup.js";

before(() => init());
beforeEach(() => reset());

describe("${endpoint.operationId}", () => {
  it("exposes a valid object schema", () => {
    const tool = ctx.tools.find((candidate) => candidate.name === "${endpoint.operationId}");
    assert.ok(tool);
    assert.equal(tool.inputSchema.type, "object");
  });

  it("sends the expected request", async () => {
    const tool = ctx.tools.find((candidate) => candidate.name === "${endpoint.operationId}");
    assert.ok(tool);
    await tool.handler(${JSON.stringify(sampleArgs)});
    assert.equal((ctx.lastFetchOptions as RequestInit).method, "${endpoint.method}");
  });
});
`;
}

export function generateWorkflowToolTest(workflow: WorkflowToolSource): string {
  const sampleArgs = Object.fromEntries(
    workflow.steps.map((step) => [
      step.id,
      buildWorkflowSampleArgs(step),
    ]),
  );
  const queuedResponses = workflow.steps.map((step, index) => {
    const mappedText = step.inputMappings.find(
      (mapping) => mapping.targetPath === "requestBody.text",
    );
    if (mappedText) {
      return index === 0
        ? { totalUsers: 42, success: true }
        : { success: true };
    }

    return { success: true };
  });
  const expectedAssertions = workflow.steps.flatMap((step, index) => {
    const assertions: string[] = [
      `    assert.equal((ctx.fetchHistory[${index}]?.options as RequestInit | undefined)?.method, "${step.endpoint.method}");`,
    ];
    for (const mapping of step.inputMappings) {
      if (mapping.targetPath === "requestBody.text") {
        assertions.push(
          `    assert.equal(JSON.parse(String(ctx.fetchHistory[${index}]?.options.body)).text, 42);`,
        );
      }
    }
    return assertions;
  });

  return `import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { ctx, init, queueResponse, reset } from "./setup.js";

before(() => init());
beforeEach(() => reset());

describe("${workflow.toolName}", () => {
  it("exposes a valid object schema", () => {
    const tool = ctx.tools.find((candidate) => candidate.name === "${workflow.toolName}");
    assert.ok(tool);
    assert.equal(tool.inputSchema.type, "object");
  });

  it("runs the workflow handler successfully", async () => {
    const tool = ctx.tools.find((candidate) => candidate.name === "${workflow.toolName}");
    assert.ok(tool);
${queuedResponses
  .map(
    (response) =>
      `    queueResponse(${JSON.stringify(response, null, 2).replace(/\n/g, "\n    ")});`,
  )
  .join("\n")}
    const result = await tool.handler(${JSON.stringify(sampleArgs)});
    assert.equal(result.isError, undefined);
    assert.equal(ctx.fetchHistory.length, ${workflow.steps.length});
${expectedAssertions.join("\n")}
  });
});
`;
}

export function generateServerTest(tools: GeneratedToolDescriptor[]): string {
  const expectedNames = tools.map((tool) => `"${tool.toolName}"`);

  return `import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { ctx, init } from "./setup.js";

before(() => init());

describe("tool registry", () => {
  it("exposes the generated tools", () => {
    const expected = [${expectedNames.join(", ")}];
    assert.equal(ctx.tools.length, ${tools.length});
    for (const name of expected) {
      assert.ok(ctx.tools.some((tool) => tool.name === name));
    }
  });
});
`;
}

export function generateExtensionManifest(serverName: string): string {
  return JSON.stringify(
    {
      name: serverName,
      version: "1.0.0",
      description: "Generated Rocket.Chat MCP server",
      contextFileName: "GEMINI.md",
      mcpServers: {
        [serverName]: {
          command: "npm",
          args: ["start"],
          cwd: "${extensionPath}",
        },
      },
    },
    null,
    2,
  ) + "\n";
}

export function generateExtensionContext(serverName: string): string {
  return `# ${serverName}

Use the tools from this generated Rocket.Chat MCP server when the user asks for the capabilities it exposes.
Keep calls minimal and only use the tools that are relevant to the request.
`;
}

export function extensionFilesForMode(
  serverName: string,
  outputMode: OutputMode,
): Record<string, string> {
  if (outputMode !== "mcp-server-extension") {
    return {};
  }

  return {
    "gemini-extension.json": generateExtensionManifest(serverName),
    "GEMINI.md": generateExtensionContext(serverName),
  };
}
