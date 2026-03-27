import {
  type CapabilityDefinition,
  endpointRequiresAuth,
  type FullEndpoint,
  type GenerationPlan,
  type OutputMode,
  type PlanWarning,
} from "../domain/index.js";

const LOGIN_OPERATION_ID = "post-api-v1-login";

export function buildGenerationPlan(input: {
  serverName?: string;
  outputMode?: OutputMode;
  endpoints: FullEndpoint[];
  selectedOperationIds: string[];
  selectedWorkflows?: string[];
  resolvedWorkflowOperationIds?: string[];
  capabilities?: CapabilityDefinition[];
  warnings?: PlanWarning[];
}): GenerationPlan {
  const serverName = input.serverName ?? "rocket-chat-mcp-server";
  const outputMode = input.outputMode ?? "mcp-server";
  const warnings: PlanWarning[] = [...(input.warnings ?? [])];
  const resolvedOperationIds = new Set(
    input.endpoints.map((endpoint) => endpoint.operationId),
  );
  const selectedOperationIds = [...new Set(input.selectedOperationIds)];
  const selectedWorkflows = [...new Set(input.selectedWorkflows ?? [])];
  const resolvedWorkflowOperationIds = [
    ...new Set(input.resolvedWorkflowOperationIds ?? []),
  ];

  const missing = selectedOperationIds.filter(
    (operationId) => !resolvedOperationIds.has(operationId),
  );
  if (missing.length > 0) {
    warnings.push({
      code: "missing_operation_ids",
      severity: "warning",
      message: `Some requested operationIds were not found: ${missing.join(", ")}`,
      details: missing,
    });
  }

  const authRequired = input.endpoints.some(endpointRequiresAuth);
  const includesLogin = resolvedOperationIds.has(LOGIN_OPERATION_ID);

  if (authRequired && !includesLogin) {
    resolvedOperationIds.add(LOGIN_OPERATION_ID);
    warnings.push({
      code: "auto_added_login",
      severity: "info",
      message: "Authentication was required, so the login endpoint was added to the plan.",
      details: [LOGIN_OPERATION_ID],
    });
  }

  return {
    serverName,
    outputMode,
    selectedOperationIds,
    selectedWorkflows,
    resolvedWorkflowOperationIds,
    resolvedOperationIds: [...resolvedOperationIds],
    capabilities: input.capabilities ?? [],
    warnings,
    authStrategy: {
      mode: authRequired ? "env-login" : "none",
      autoIncludeLoginTool: authRequired,
      requiresAuth: authRequired,
    },
  };
}
