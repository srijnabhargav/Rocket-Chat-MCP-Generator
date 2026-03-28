import {
  type EndpointFieldRef,
  type FullEndpoint,
  type SchemaConnection,
  type SchemaConnectionConfidence,
} from "../domain/index.js";

const FIELD_ALIAS_GROUPS: Array<[string, string[]]> = [
  ["room_id", ["roomid", "room_id", "rid", "channelid", "channel_id"]],
  ["room_name", ["roomname", "room_name", "channelname", "channel_name"]],
  ["user_id", ["userid", "user_id", "uid", "ownerid", "owner_id"]],
  ["user_name", ["username", "user_name"]],
  ["message_id", ["messageid", "message_id", "msgid", "msg_id"]],
];

const PATH_HINT_GROUPS: Array<[string, string[]]> = [
  ["room_id", ["room", "rooms", "channel", "channels"]],
  ["user_id", ["user", "users", "owner", "owners", "member", "members", "u", "me", "createdby", "actor"]],
  ["message_id", ["message", "messages", "lastmessage"]],
  ["department_id", ["department", "departments"]],
  ["team_id", ["team", "teams"]],
  ["agent_id", ["agent", "agents"]],
  ["visitor_id", ["visitor", "visitors", "v"]],
  ["integration_id", ["integration", "integrations"]],
  ["file_id", ["file", "files"]],
  ["role_id", ["role", "roles"]],
];

const NOISY_FIELDS = new Set([
  "count", "offset", "total", "success",
  "updatedat", "createdat", "ts", "lm",
  "name", "type", "description", "status", "value", "text", "title",
  "enabled", "active", "msg", "roles", "email", "customfields",
  "scope", "t", "alias", "default", "encrypted", "verified",
  "groupable", "broadcast", "visibility", "label", "showonregistration",
  "open", "format", "method", "url", "password", "values",
  "latest", "topic",
]);

const ENTITY_NAME_FIELDS = new Set(["room_name", "user_name"]);

const ENTITY_FIELDS = new Set([
  ...FIELD_ALIAS_GROUPS.map(([key]) => key).filter(
    (key) => !ENTITY_NAME_FIELDS.has(key),
  ),
  "department_id", "team_id", "agent_id", "visitor_id",
  "integration_id", "file_id", "role_id",
  "teamid", "departmentid", "appid", "agentid",
  "visitorid", "sessionid", "callid", "token",
]);

const FANOUT_THRESHOLD_RATIO = 0.20;

export function isNoisyField(
  fieldName: string,
  fanoutSources: number,
  fanoutTargets: number,
  totalEndpoints: number,
): boolean {
  if (NOISY_FIELDS.has(fieldName)) {
    return true;
  }
  if (ENTITY_FIELDS.has(fieldName)) {
    return false;
  }
  const threshold = Math.ceil(totalEndpoints * FANOUT_THRESHOLD_RATIO);
  return fanoutSources > threshold || fanoutTargets > threshold;
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function getSchemaType(schema: Record<string, unknown>): string {
  const schemaType = schema.type;
  if (Array.isArray(schemaType)) {
    const firstString = schemaType.find(
      (value): value is string => typeof value === "string" && value !== "null",
    );
    if (firstString) {
      return firstString;
    }
  }

  if (typeof schemaType === "string") {
    return schemaType;
  }
  if (schema.properties && typeof schema.properties === "object") {
    return "object";
  }
  if (schema.items && typeof schema.items === "object") {
    return "array";
  }

  return "unknown";
}

function getPathTokens(path: string): string[] {
  return path
    .split(".")
    .flatMap((segment) => segment.split("[]"))
    .map(normalizeToken)
    .filter((token) => token.length > 0);
}

function inferSemanticKey(fieldName: string, fieldPath: string): string {
  const normalizedName = normalizeToken(fieldName);

  for (const [key, aliases] of FIELD_ALIAS_GROUPS) {
    if (aliases.includes(normalizedName)) {
      return key;
    }
  }

  if (normalizedName === "id" || normalizedName === "_id") {
    const pathTokens = getPathTokens(fieldPath);
    for (const [key, hints] of PATH_HINT_GROUPS) {
      if (pathTokens.some((token) => hints.includes(token))) {
        return key;
      }
    }
  }

  return normalizedName;
}

function collectSchemaFields(input: {
  endpointId: string;
  direction: EndpointFieldRef["direction"];
  schema: Record<string, unknown>;
  path?: string;
}): EndpointFieldRef[] {
  const currentPath = input.path ?? "";
  const currentType = getSchemaType(input.schema);
  const properties = input.schema.properties;
  const items = input.schema.items;

  if (
    currentType === "object" &&
    properties &&
    typeof properties === "object" &&
    !Array.isArray(properties)
  ) {
    return Object.entries(properties).flatMap(([key, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return [];
      }

      const childPath = currentPath ? `${currentPath}.${key}` : key;
      return collectSchemaFields({
        endpointId: input.endpointId,
        direction: input.direction,
        schema: value as Record<string, unknown>,
        path: childPath,
      });
    });
  }

  if (currentType === "array" && items && typeof items === "object" && !Array.isArray(items)) {
    return collectSchemaFields({
      endpointId: input.endpointId,
      direction: input.direction,
      schema: items as Record<string, unknown>,
      path: `${currentPath}[]`,
    });
  }

  if (!currentPath) {
    return [];
  }

  const pathSegments = currentPath.split(".");
  const rawFieldName = pathSegments[pathSegments.length - 1]?.replace(/\[\]/g, "") ?? "value";
  const fieldName = inferSemanticKey(rawFieldName, currentPath);

  return [
    {
      operationId: input.endpointId,
      fieldName,
      fieldPath: currentPath,
      type: currentType,
      direction: input.direction,
    },
  ];
}

function scoreConnection(input: {
  outputField: EndpointFieldRef;
  inputField: EndpointFieldRef;
}): SchemaConnectionConfidence | null {
  if (input.outputField.fieldName !== input.inputField.fieldName) {
    return null;
  }

  if (input.outputField.type === input.inputField.type) {
    return input.outputField.fieldPath.endsWith(input.inputField.fieldName)
      ? "exact"
      : "likely";
  }

  if (input.outputField.type === "unknown" || input.inputField.type === "unknown") {
    return "possible";
  }

  if (
    ["number", "integer"].includes(input.outputField.type) &&
    ["number", "integer"].includes(input.inputField.type)
  ) {
    return "likely";
  }

  return null;
}

function compareConfidence(
  left: SchemaConnectionConfidence,
  right: SchemaConnectionConfidence,
): number {
  const order: Record<SchemaConnectionConfidence, number> = {
    exact: 3,
    likely: 2,
    possible: 1,
  };

  return order[left] - order[right];
}

export function extractEndpointFields(endpoint: FullEndpoint): EndpointFieldRef[] {
  const fields = collectSchemaFields({
    endpointId: endpoint.operationId,
    direction: "input",
    schema: endpoint.inputSchema,
  });

  if (endpoint.responseSchema) {
    fields.push(
      ...collectSchemaFields({
        endpointId: endpoint.operationId,
        direction: "output",
        schema: endpoint.responseSchema.schema,
      }),
    );
  }

  return fields;
}

export function buildSchemaConnections(endpoints: FullEndpoint[]): SchemaConnection[] {
  const fieldsByEndpoint = new Map(
    endpoints.map((endpoint) => [endpoint.operationId, extractEndpointFields(endpoint)]),
  );
  const outputFields = [...fieldsByEndpoint.values()].flatMap((fields) =>
    fields.filter((field) => field.direction === "output"),
  );
  const inputFields = [...fieldsByEndpoint.values()].flatMap((fields) =>
    fields.filter((field) => field.direction === "input"),
  );
  const connections = new Map<string, SchemaConnection>();

  for (const outputField of outputFields) {
    if (NOISY_FIELDS.has(outputField.fieldName)) {
      continue;
    }

    for (const inputField of inputFields) {
      if (outputField.operationId === inputField.operationId) {
        continue;
      }

      const confidence = scoreConnection({ outputField, inputField });
      if (!confidence) {
        continue;
      }

      const key = [
        outputField.operationId,
        outputField.fieldPath,
        inputField.operationId,
        inputField.fieldPath,
      ].join("::");
      const existing = connections.get(key);
      if (!existing || compareConfidence(confidence, existing.confidence) > 0) {
        connections.set(key, {
          from: outputField,
          to: inputField,
          fieldName: inputField.fieldName,
          confidence,
        });
      }
    }
  }

  const allConnections = [...connections.values()];
  const totalEndpoints = endpoints.length;

  if (ENTITY_FIELDS.size === 0 && NOISY_FIELDS.size === 0) {
    return allConnections;
  }

  const fanoutByField = new Map<string, { sources: Set<string>; targets: Set<string> }>();
  for (const connection of allConnections) {
    let stats = fanoutByField.get(connection.fieldName);
    if (!stats) {
      stats = { sources: new Set(), targets: new Set() };
      fanoutByField.set(connection.fieldName, stats);
    }
    stats.sources.add(connection.from.operationId);
    stats.targets.add(connection.to.operationId);
  }

  return allConnections.filter((connection) => {
    const stats = fanoutByField.get(connection.fieldName);
    if (!stats) {
      return true;
    }
    return !isNoisyField(
      connection.fieldName,
      stats.sources.size,
      stats.targets.size,
      totalEndpoints,
    );
  });
}
