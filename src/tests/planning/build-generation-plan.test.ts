import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDependencyGraph,
  buildGenerationPlan,
  groupCapabilities,
  resolveEndpointDependencies,
  resolveWorkflowSelections,
} from "../../planning/index.js";
import { injectPrerequisiteLookups } from "../../discovery/index.js";
import {
  channelsInfoEndpoint,
  channelsListEndpoint,
  loginEndpoint,
  postMessageEndpoint,
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

describe("resolvePlan prerequisite injection", () => {
  it("injects GET lookup endpoints when only write endpoints are selected", () => {
    const allEndpoints = [
      channelsInfoEndpoint,
      channelsListEndpoint,
      postMessageEndpoint,
      loginEndpoint,
      statisticsEndpoint,
    ];
    const graph = buildDependencyGraph(allEndpoints);

    const enrichedIds = injectPrerequisiteLookups({
      selectedIds: [postMessageEndpoint.operationId],
      graph,
    });

    const depResolution = resolveEndpointDependencies(enrichedIds, graph);
    const fullyResolvedIds = [...new Set([...enrichedIds, ...depResolution.required])];

    const resolvedEndpoints = fullyResolvedIds
      .map((id) => graph.endpointsById.get(id))
      .filter((ep): ep is typeof postMessageEndpoint => Boolean(ep));

    const plan = buildGenerationPlan({
      serverName: "test-server",
      endpoints: resolvedEndpoints,
      selectedOperationIds: [postMessageEndpoint.operationId],
    });

    const hasGetLookup = plan.resolvedOperationIds.some((id) => {
      const ep = graph.endpointsById.get(id);
      return ep && ep.method === "GET" && id !== "post-api-v1-login";
    });
    assert.ok(
      hasGetLookup,
      "Plan must include a GET lookup endpoint when write endpoints need entity IDs",
    );
    assert.ok(
      plan.resolvedOperationIds.includes("post-api-v1-login"),
      "Plan must auto-include login when auth is required",
    );
  });

  it("does not inject prerequisites for GET-only selections", () => {
    const allEndpoints = [
      channelsInfoEndpoint,
      channelsListEndpoint,
      statisticsEndpoint,
      loginEndpoint,
    ];
    const graph = buildDependencyGraph(allEndpoints);

    const selectedIds = [statisticsEndpoint.operationId];
    const hasWriteEndpoint = selectedIds.some((id) => {
      const ep = graph.endpointsById.get(id);
      return ep && ep.method !== "GET";
    });
    const enrichedIds = hasWriteEndpoint
      ? injectPrerequisiteLookups({ selectedIds, graph })
      : selectedIds;

    assert.deepEqual(enrichedIds, selectedIds);
  });
});
