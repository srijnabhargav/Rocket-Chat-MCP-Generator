import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildGenerationPlan,
  resolveWorkflowSelections,
} from "../../planning/index.js";
import {
  channelsListEndpoint,
  statisticsEndpoint,
} from "../fixtures/endpoints.js";

describe("buildGenerationPlan", () => {
  it("keeps auth-free plans minimal", () => {
    const plan = buildGenerationPlan({
      endpoints: [statisticsEndpoint],
      selectedOperationIds: [statisticsEndpoint.operationId],
    });

    assert.equal(plan.authStrategy.mode, "none");
    assert.equal(plan.authStrategy.requiresAuth, false);
    assert.equal(plan.authStrategy.autoIncludeLoginTool, false);
    assert.deepEqual(plan.selectedWorkflows, []);
    assert.deepEqual(plan.resolvedWorkflowOperationIds, []);
    assert.deepEqual(plan.resolvedOperationIds, [statisticsEndpoint.operationId]);
  });

  it("adds login when auth is required", () => {
    const plan = buildGenerationPlan({
      endpoints: [channelsListEndpoint],
      selectedOperationIds: [channelsListEndpoint.operationId],
    });

    assert.equal(plan.authStrategy.mode, "env-login");
    assert.equal(plan.authStrategy.requiresAuth, true);
    assert.equal(plan.authStrategy.autoIncludeLoginTool, true);
    assert.ok(plan.resolvedOperationIds.includes("post-api-v1-login"));
    assert.ok(
      plan.warnings.some((warning) => warning.code === "auto_added_login"),
    );
  });

  it("resolves workflows into operationIds before planning", () => {
    const workflowResolution = resolveWorkflowSelections([
      "monitor_workspace_statistics",
    ]);
    const plan = buildGenerationPlan({
      endpoints: [statisticsEndpoint],
      selectedOperationIds: [],
      selectedWorkflows: workflowResolution.selectedWorkflows,
      resolvedWorkflowOperationIds: workflowResolution.resolvedWorkflowOperationIds,
      warnings: workflowResolution.warnings,
    });

    assert.deepEqual(plan.selectedWorkflows, ["monitor_workspace_statistics"]);
    assert.deepEqual(plan.resolvedWorkflowOperationIds, [
      "get-api-v1-statistics",
    ]);
  });

  it("emits a structured warning for unknown workflows", () => {
    const workflowResolution = resolveWorkflowSelections(["missing_workflow"]);

    assert.ok(
      workflowResolution.warnings.some(
        (warning) => warning.code === "unknown_workflows",
      ),
    );
  });
});
