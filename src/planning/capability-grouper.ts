import {
  type CapabilityDefinition,
  type FullEndpoint,
  type SchemaConnection,
  type SchemaConnectionConfidence,
  type WorkflowInputMapping,
  type WorkflowStepDefinition,
} from "../domain/index.js";
import type { DependencyGraph } from "./dependency-graph.js";

const MAX_CAPABILITY_STEPS = 3;

const ENTITY_ID_FIELD_NAMES = new Set([
  "room_id", "user_id", "message_id", "team_id",
  "department_id", "agent_id", "visitor_id",
  "integration_id", "file_id", "role_id",
]);

function normalizeFieldName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

function isEntityIdField(fieldName: string): boolean {
  if (ENTITY_ID_FIELD_NAMES.has(fieldName)) {
    return true;
  }
  const normalized = normalizeFieldName(fieldName);
  if (ENTITY_ID_FIELD_NAMES.has(normalized)) {
    return true;
  }
  return /(?:room|user|message|team|department|agent|visitor|integration|file|role)[_]?id$/i.test(fieldName);
}

const CONFIDENCE_SCORE: Record<SchemaConnectionConfidence, number> = {
  exact: 3,
  likely: 2,
  possible: 1,
};

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return slug || "capability";
}

function compareEndpoints(left: FullEndpoint, right: FullEndpoint): number {
  if (left.method === right.method) {
    return left.operationId.localeCompare(right.operationId);
  }
  if (left.method === "GET") {
    return -1;
  }
  if (right.method === "GET") {
    return 1;
  }

  return left.operationId.localeCompare(right.operationId);
}

function choosePrimaryEndpoint(
  endpoints: FullEndpoint[],
  preferredIds: Set<string>,
): FullEndpoint {
  const preferredEndpoints = endpoints.filter((endpoint) =>
    preferredIds.has(endpoint.operationId),
  );
  const nonGetPreferred = preferredEndpoints.find((endpoint) => endpoint.method !== "GET");
  if (nonGetPreferred) {
    return nonGetPreferred;
  }
  if (preferredEndpoints[0]) {
    return preferredEndpoints[0];
  }

  return (
    endpoints.find((endpoint) => endpoint.method !== "GET") ??
    endpoints.slice().sort(compareEndpoints)[0]!
  );
}

function buildOrderedEndpoints(
  componentEndpoints: FullEndpoint[],
  primaryEndpoint: FullEndpoint,
  relevantFlows: SchemaConnection[],
): FullEndpoint[] {
  const endpointMap = new Map(
    componentEndpoints.map((endpoint) => [endpoint.operationId, endpoint]),
  );
  const prerequisites = new Set<string>();

  for (const flow of relevantFlows) {
    if (flow.to.operationId === primaryEndpoint.operationId) {
      prerequisites.add(flow.from.operationId);
    }
  }

  const prerequisiteEndpoints = [...prerequisites]
    .map((operationId) => endpointMap.get(operationId))
    .filter((endpoint): endpoint is FullEndpoint => Boolean(endpoint))
    .sort(compareEndpoints);
  const remainingEndpoints = componentEndpoints
    .filter(
      (endpoint) =>
        endpoint.operationId !== primaryEndpoint.operationId &&
        !prerequisites.has(endpoint.operationId),
    )
    .sort(compareEndpoints);

  return [...prerequisiteEndpoints, primaryEndpoint, ...remainingEndpoints];
}

function buildInputMappings(
  step: FullEndpoint,
  orderedSteps: Array<{ id: string; operationId: string }>,
  dataFlows: SchemaConnection[],
): WorkflowInputMapping[] {
  const availableStepIds = new Map(
    orderedSteps.map((orderedStep) => [orderedStep.operationId, orderedStep.id]),
  );

  const seenTargets = new Set<string>();
  return dataFlows
    .filter((flow) => flow.to.operationId === step.operationId)
    .flatMap((flow) => {
      const sourceStepId = availableStepIds.get(flow.from.operationId);
      if (!sourceStepId) {
        return [];
      }
      if (seenTargets.has(flow.to.fieldPath)) {
        return [];
      }
      seenTargets.add(flow.to.fieldPath);

      return [
        {
          targetPath: flow.to.fieldPath,
          sourceStepId,
          sourcePath: flow.from.fieldPath,
        },
      ];
    });
}

interface WeightedEdge {
  a: string;
  b: string;
  weight: number;
}

function scoreEdge(
  connection: SchemaConnection,
  endpointsById: Map<string, FullEndpoint>,
): number {
  let weight = CONFIDENCE_SCORE[connection.confidence];
  const from = endpointsById.get(connection.from.operationId);
  const to = endpointsById.get(connection.to.operationId);
  if (from && to && from.domain === to.domain) {
    weight += 4;
  }
  return weight;
}

function buildComponentEdges(
  component: string[],
  graph: DependencyGraph,
): WeightedEdge[] {
  const memberSet = new Set(component);
  const edgeMap = new Map<string, WeightedEdge>();

  for (const connection of graph.connections) {
    const a = connection.from.operationId;
    const b = connection.to.operationId;
    if (!memberSet.has(a) || !memberSet.has(b)) {
      continue;
    }
    const key = a < b ? `${a}::${b}` : `${b}::${a}`;
    const existing = edgeMap.get(key);
    const weight = scoreEdge(connection, graph.endpointsById);
    if (!existing || weight > existing.weight) {
      edgeMap.set(key, { a: a < b ? a : b, b: a < b ? b : a, weight });
    }
  }

  return [...edgeMap.values()];
}

function bfsComponent(start: string, adjacency: Map<string, Set<string>>): Set<string> {
  const visited = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!visited.has(neighbor)) {
        queue.push(neighbor);
      }
    }
  }
  return visited;
}

function splitByDomain(
  component: string[],
  endpointsById: Map<string, FullEndpoint>,
): string[][] {
  const byDomain = new Map<string, string[]>();
  for (const id of component) {
    const domain = endpointsById.get(id)?.domain ?? "unknown";
    const group = byDomain.get(domain) ?? [];
    group.push(id);
    byDomain.set(domain, group);
  }
  return [...byDomain.values()];
}

function splitOversizedComponent(
  component: string[],
  graph: DependencyGraph,
): string[][] {
  if (component.length <= MAX_CAPABILITY_STEPS) {
    return [component];
  }

  const edges = buildComponentEdges(component, graph);
  const sorted = edges.slice().sort((a, b) => a.weight - b.weight);

  for (const weakest of sorted) {
    const adjacency = new Map<string, Set<string>>();
    for (const id of component) {
      adjacency.set(id, new Set());
    }
    for (const edge of edges) {
      if (edge === weakest) {
        continue;
      }
      adjacency.get(edge.a)?.add(edge.b);
      adjacency.get(edge.b)?.add(edge.a);
    }

    const firstPart = bfsComponent(component[0]!, adjacency);
    if (firstPart.size === component.length) {
      continue;
    }

    const partA = component.filter((id) => firstPart.has(id));
    const partB = component.filter((id) => !firstPart.has(id));
    return [
      ...splitOversizedComponent(partA, graph),
      ...splitOversizedComponent(partB, graph),
    ];
  }

  const domainGroups = splitByDomain(component, graph.endpointsById);
  if (domainGroups.length > 1) {
    return domainGroups.flatMap((group) => splitOversizedComponent(group, graph));
  }

  const chunks: string[][] = [];
  for (let i = 0; i < component.length; i += MAX_CAPABILITY_STEPS) {
    chunks.push(component.slice(i, i + MAX_CAPABILITY_STEPS));
  }
  return chunks;
}

function isStrongDataDependency(
  connection: SchemaConnection,
  endpointsById: Map<string, FullEndpoint>,
): boolean {
  const from = endpointsById.get(connection.from.operationId);
  const to = endpointsById.get(connection.to.operationId);
  if (!from || !to) {
    return false;
  }

  if (from.method !== "GET") {
    return false;
  }

  if (to.method === "GET") {
    return false;
  }

  if (!isEntityIdField(connection.fieldName)) {
    return false;
  }

  if (connection.from.direction !== "output" || connection.to.direction !== "input") {
    return false;
  }

  if (connection.confidence === "possible") {
    return false;
  }

  return true;
}

function splitComponentByWriteEndpoint(
  component: string[],
  endpointsById: Map<string, FullEndpoint>,
  adjacency: Map<string, Set<string>>,
): string[][] {
  const writeIds = component.filter((id) => {
    const ep = endpointsById.get(id);
    return ep && ep.method !== "GET";
  });

  if (writeIds.length <= 1) {
    return [component];
  }

  const result: string[][] = [];
  const assignedGetIds = new Set<string>();

  for (const writeId of writeIds) {
    const neighbors = adjacency.get(writeId) ?? new Set();
    const getPrereqs = [...neighbors].filter((id) => {
      const ep = endpointsById.get(id);
      return ep && ep.method === "GET";
    });
    result.push([...getPrereqs, writeId]);
    getPrereqs.forEach((id) => assignedGetIds.add(id));
  }

  const orphanGets = component.filter((id) => {
    const ep = endpointsById.get(id);
    return ep && ep.method === "GET" && !assignedGetIds.has(id);
  });
  for (const getId of orphanGets) {
    result.push([getId]);
  }

  return result;
}

function collectComponents(
  endpointIds: string[],
  graph: DependencyGraph,
): string[][] {
  const endpointSet = new Set(endpointIds);
  const adjacency = new Map<string, Set<string>>();

  for (const endpointId of endpointIds) {
    adjacency.set(endpointId, new Set());
  }

  for (const connection of graph.connections) {
    if (
      !endpointSet.has(connection.from.operationId) ||
      !endpointSet.has(connection.to.operationId)
    ) {
      continue;
    }

    if (!isStrongDataDependency(connection, graph.endpointsById)) {
      continue;
    }

    adjacency.get(connection.from.operationId)?.add(connection.to.operationId);
    adjacency.get(connection.to.operationId)?.add(connection.from.operationId);
  }

  const rawComponents: string[][] = [];
  const visited = new Set<string>();
  for (const endpointId of endpointIds) {
    if (visited.has(endpointId)) {
      continue;
    }

    const queue = [endpointId];
    const component: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current)) {
        continue;
      }
      visited.add(current);
      component.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }
    rawComponents.push(component);
  }

  return rawComponents.flatMap((component) =>
    splitComponentByWriteEndpoint(component, graph.endpointsById, adjacency),
  );
}

export function groupCapabilities(input: {
  endpointIds: string[];
  preferredOperationIds: string[];
  graph: DependencyGraph;
}): CapabilityDefinition[] {
  const preferredIds = new Set(input.preferredOperationIds);
  const usedNames = new Set<string>();

  const rawComponents = collectComponents(input.endpointIds, input.graph);
  const components = rawComponents.flatMap((component) =>
    splitOversizedComponent(component, input.graph),
  );

  return components.flatMap((component, index) => {
    const componentEndpoints = component
      .map((operationId) => input.graph.endpointsById.get(operationId))
      .filter((endpoint): endpoint is FullEndpoint => Boolean(endpoint))
      .sort(compareEndpoints);
    if (componentEndpoints.length === 0) {
      return [];
    }
    const primaryEndpoint = choosePrimaryEndpoint(componentEndpoints, preferredIds);
    const relevantFlows = input.graph.connections.filter(
      (connection) =>
        component.includes(connection.from.operationId) &&
        component.includes(connection.to.operationId),
    );
    const orderedEndpoints = buildOrderedEndpoints(
      componentEndpoints,
      primaryEndpoint,
      relevantFlows,
    );
    const orderedSteps: WorkflowStepDefinition[] = [];

    for (const [stepIndex, endpoint] of orderedEndpoints.entries()) {
      const stepId = `${slugify(endpoint.summary || endpoint.operationId)}_${stepIndex + 1}`;
      orderedSteps.push({
        id: stepId,
        operationId: endpoint.operationId,
        inputMappings: buildInputMappings(endpoint, orderedSteps, relevantFlows),
      });
    }

    let name = slugify(primaryEndpoint.summary || primaryEndpoint.operationId);
    if (usedNames.has(name)) {
      name = `${name}_${index + 1}`;
    }
    usedNames.add(name);

    const prerequisites = orderedEndpoints
      .filter(
        (endpoint) =>
          endpoint.operationId !== primaryEndpoint.operationId && endpoint.method === "GET",
      )
      .map((endpoint) => endpoint.operationId);
    const componentOperationIds = orderedEndpoints.map((endpoint) => endpoint.operationId);
    const description =
      orderedEndpoints.length === 1
        ? primaryEndpoint.summary || primaryEndpoint.description
        : `Compose ${orderedEndpoints
            .map((endpoint) => endpoint.summary || endpoint.operationId)
            .join(" -> ")}`;

    return [{
      name,
      description,
      endpoints: componentOperationIds,
      primaryEndpoint: primaryEndpoint.operationId,
      prerequisites,
      dataFlows: relevantFlows,
      steps: orderedSteps,
      isComposed: orderedSteps.length > 1,
    }];
  });
}
