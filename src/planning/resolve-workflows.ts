import { getWorkflowByName } from "../discovery/index.js";
import type { PlanWarning } from "../domain/index.js";

export function resolveWorkflowSelections(workflowNames: string[]): {
  selectedWorkflows: string[];
  resolvedWorkflowOperationIds: string[];
  warnings: PlanWarning[];
} {
  const warnings: PlanWarning[] = [];
  const selectedWorkflows: string[] = [];
  const operationIds = new Set<string>();
  const seenWorkflows = new Set<string>();

  for (const workflowName of workflowNames) {
    if (seenWorkflows.has(workflowName)) {
      warnings.push({
        code: "duplicate_selection",
        severity: "info",
        message: `Workflow "${workflowName}" was selected more than once.`,
        details: [workflowName],
      });
      continue;
    }
    seenWorkflows.add(workflowName);

    const workflow = getWorkflowByName(workflowName);
    if (!workflow) {
      warnings.push({
        code: "unknown_workflows",
        severity: "warning",
        message: `Workflow "${workflowName}" is not defined in the workflow catalog.`,
        details: [workflowName],
      });
      continue;
    }

    selectedWorkflows.push(workflow.name);
    for (const step of workflow.steps) {
      operationIds.add(step.operationId);
    }
  }

  return {
    selectedWorkflows,
    resolvedWorkflowOperationIds: [...operationIds],
    warnings,
  };
}
