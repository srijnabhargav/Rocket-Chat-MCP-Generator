import {
  type FullEndpoint,
  type SchemaConnection,
  type SchemaConnectionConfidence,
} from "../domain/index.js";
import { buildSchemaConnections } from "../specs/index.js";

export interface DependencyGraph {
  connections: SchemaConnection[];
  endpointsById: Map<string, FullEndpoint>;
  incomingByOperationId: Map<string, SchemaConnection[]>;
  outgoingByOperationId: Map<string, SchemaConnection[]>;
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

function rankConnection(
  connection: SchemaConnection,
  endpointsById: Map<string, FullEndpoint>,
): number {
  const sourceEndpoint = endpointsById.get(connection.from.operationId);
  const targetEndpoint = endpointsById.get(connection.to.operationId);
  let score = compareConfidence(connection.confidence, "possible");

  if (sourceEndpoint?.method === "GET") {
    score += 4;
  }
  if (targetEndpoint && sourceEndpoint && sourceEndpoint.domain === targetEndpoint.domain) {
    score += 2;
  }
  if (connection.from.fieldName === connection.to.fieldName) {
    score += 1;
  }

  return score;
}

export function buildDependencyGraph(endpoints: FullEndpoint[]): DependencyGraph {
  const endpointsById = new Map(
    endpoints.map((endpoint) => [endpoint.operationId, endpoint]),
  );
  const connections = buildSchemaConnections(endpoints);
  const incomingByOperationId = new Map<string, SchemaConnection[]>();
  const outgoingByOperationId = new Map<string, SchemaConnection[]>();

  for (const connection of connections) {
    const incoming = incomingByOperationId.get(connection.to.operationId) ?? [];
    incoming.push(connection);
    incomingByOperationId.set(connection.to.operationId, incoming);

    const outgoing = outgoingByOperationId.get(connection.from.operationId) ?? [];
    outgoing.push(connection);
    outgoingByOperationId.set(connection.from.operationId, outgoing);
  }

  return {
    connections,
    endpointsById,
    incomingByOperationId,
    outgoingByOperationId,
  };
}

function selectBestIncomingConnections(
  targetId: string,
  graph: DependencyGraph,
): SchemaConnection[] {
  const incoming = graph.incomingByOperationId.get(targetId) ?? [];
  const bestByField = new Map<string, SchemaConnection>();

  for (const connection of incoming) {
    const key = connection.to.fieldPath;
    const existing = bestByField.get(key);
    if (!existing) {
      bestByField.set(key, connection);
      continue;
    }

    const existingScore = rankConnection(existing, graph.endpointsById);
    const nextScore = rankConnection(connection, graph.endpointsById);
    if (nextScore > existingScore) {
      bestByField.set(key, connection);
    }
  }

  return [...bestByField.values()];
}

export function resolveEndpointDependencies(
  targetIds: string[],
  graph: DependencyGraph,
): {
  required: string[];
  recommended: string[];
  dataFlows: SchemaConnection[];
} {
  const selected = new Set(targetIds);
  const required = new Set<string>();
  const recommended = new Set<string>();
  const dataFlows = new Map<string, SchemaConnection>();
  const queue = [...targetIds];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const targetId = queue.shift();
    if (!targetId || visited.has(targetId)) {
      continue;
    }
    visited.add(targetId);
    const targetEndpoint = graph.endpointsById.get(targetId);
    if (!targetEndpoint || targetEndpoint.method === "GET") {
      continue;
    }

    for (const connection of selectBestIncomingConnections(targetId, graph)) {
      const sourceId = connection.from.operationId;
      const sourceEndpoint = graph.endpointsById.get(sourceId);
      if (!sourceEndpoint) {
        continue;
      }

      const key = [
        connection.from.operationId,
        connection.from.fieldPath,
        connection.to.operationId,
        connection.to.fieldPath,
      ].join("::");
      dataFlows.set(key, connection);

      if (!selected.has(sourceId) && !required.has(sourceId)) {
        required.add(sourceId);
        if (sourceEndpoint.method !== "GET") {
          queue.push(sourceId);
        }
      }
    }
  }

  const considerationSet = new Set([...selected, ...required]);
  for (const operationId of considerationSet) {
    const outgoing = graph.outgoingByOperationId.get(operationId) ?? [];
    for (const connection of outgoing) {
      if (
        considerationSet.has(connection.to.operationId) ||
        compareConfidence(connection.confidence, "likely") < 0
      ) {
        continue;
      }

      recommended.add(connection.to.operationId);
    }
  }

  return {
    required: [...required],
    recommended: [...recommended],
    dataFlows: [...dataFlows.values()],
  };
}
