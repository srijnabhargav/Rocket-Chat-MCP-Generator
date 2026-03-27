import {
  type CapabilityDefinition,
  type FullEndpoint,
  type SchemaConnection,
  type WorkflowInputMapping,
  type WorkflowStepDefinition,
} from "../domain/index.js";
import type { DependencyGraph } from "./dependency-graph.js";

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

  return dataFlows
    .filter((flow) => flow.to.operationId === step.operationId)
    .flatMap((flow) => {
      const sourceStepId = availableStepIds.get(flow.from.operationId);
      if (!sourceStepId) {
        return [];
      }

      return [
        {
          targetPath: flow.to.fieldPath,
          sourceStepId,
          sourcePath: flow.from.fieldPath,
        },
      ];
    });
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

    adjacency.get(connection.from.operationId)?.add(connection.to.operationId);
    adjacency.get(connection.to.operationId)?.add(connection.from.operationId);
  }

  const components: string[][] = [];
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
    components.push(component);
  }

  return components;
}

export function groupCapabilities(input: {
  endpointIds: string[];
  preferredOperationIds: string[];
  graph: DependencyGraph;
}): CapabilityDefinition[] {
  const preferredIds = new Set(input.preferredOperationIds);
  const usedNames = new Set<string>();

  return collectComponents(input.endpointIds, input.graph).map((component, index) => {
    const componentEndpoints = component
      .map((operationId) => input.graph.endpointsById.get(operationId))
      .filter((endpoint): endpoint is FullEndpoint => Boolean(endpoint))
      .sort(compareEndpoints);
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

    return {
      name,
      description,
      endpoints: componentOperationIds,
      primaryEndpoint: primaryEndpoint.operationId,
      prerequisites,
      dataFlows: relevantFlows,
      steps: orderedSteps,
      isComposed: orderedSteps.length > 1,
    };
  });
}
