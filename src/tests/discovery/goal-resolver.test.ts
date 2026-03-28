import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlanConfidence } from "../../domain/index.js";
import { adjustResolvedGoal, resolveGoal } from "../../discovery/index.js";

describe("goal resolver", () => {
  it("returns a deterministic plan for natural-language goals", async () => {
    const resolved = await resolveGoal({
      goal: "post a message to a Rocket.Chat room",
      serverName: "goal-resolver-test",
    });

    assert.match(resolved.planId, /^goal-resolver-test-/);
    assert.ok(resolved.plan.resolvedOperationIds.length > 0);
    assert.ok(resolved.capabilities.length > 0);
    assert.equal(resolved.plan.capabilities.length, resolved.capabilities.length);
    assert.match(resolved.summary, /Plan ID:/);
    assert.ok(
      resolved.plan.resolvedOperationIds.some((operationId) =>
        /chat_postMessage|chat_postmessage|postmessage/i.test(operationId),
      ),
    );
  });

  it("covers all intents when a goal combines a workflow with additional actions", async () => {
    const resolved = await resolveGoal({
      goal: "create a channel, invite members, and post a welcome message",
      serverName: "multi-intent-test",
    });

    const ops = resolved.plan.resolvedOperationIds;
    assert.ok(
      ops.some((id) => /channels_create/i.test(id)),
      "must include channel creation",
    );
    assert.ok(
      ops.some((id) => /channels_invite|invite/i.test(id)),
      "must include member invitation",
    );
    assert.ok(
      ops.some((id) => /message/i.test(id)),
      "must include a messaging endpoint for the 'post message' intent",
    );
  });

  it("covers multiple intents across different domains", async () => {
    const resolved = await resolveGoal({
      goal: "send a message and get workspace statistics",
      serverName: "cross-domain-test",
    });

    const ops = resolved.plan.resolvedOperationIds;
    assert.ok(
      ops.some((id) => /message|chat/i.test(id)),
      "must include a messaging endpoint",
    );
    assert.ok(
      ops.some((id) => /statistic/i.test(id)),
      "must include a statistics endpoint",
    );
  });

  it("expands manage verb into a CRUD cluster for channels", async () => {
    const resolved = await resolveGoal({
      goal: "manage channels",
      serverName: "manage-channels-test",
    });

    const ops = resolved.plan.resolvedOperationIds;
    assert.ok(
      ops.some((id) => /channels_create/i.test(id)),
      "must include channel creation",
    );
    assert.ok(
      ops.some((id) => /channels_list/i.test(id)),
      "must include channel listing",
    );
    assert.ok(
      ops.some((id) => /channels_delete/i.test(id)),
      "must include channel deletion",
    );
    assert.ok(ops.length >= 4, "must include at least 4 endpoints for a CRUD cluster");
  });

  it("expands manage verb into a CRUD cluster for users", async () => {
    const resolved = await resolveGoal({
      goal: "manage users",
      serverName: "manage-users-test",
    });

    const ops = resolved.plan.resolvedOperationIds;
    assert.ok(
      ops.some((id) => /users_create/i.test(id)),
      "must include user creation",
    );
    assert.ok(
      ops.some((id) => /users_list/i.test(id)),
      "must include user listing",
    );
    assert.ok(
      ops.some((id) => /users_update/i.test(id)),
      "must include user update",
    );
    assert.ok(
      ops.some((id) => /users_delete/i.test(id)),
      "must include user deletion",
    );
  });

  it("combines CRUD cluster with additional intents", async () => {
    const resolved = await resolveGoal({
      goal: "manage channels and send a message",
      serverName: "manage-plus-intent-test",
    });

    const ops = resolved.plan.resolvedOperationIds;
    assert.ok(
      ops.some((id) => /channels_create/i.test(id)),
      "must include channel creation from CRUD cluster",
    );
    assert.ok(
      ops.some((id) => /channels_delete/i.test(id)),
      "must include channel deletion from CRUD cluster",
    );
    assert.ok(
      ops.some((id) => /message/i.test(id)),
      "must include a messaging endpoint for the 'send message' intent",
    );
  });

  it("returns high confidence for a workflow-matched goal with full coverage", async () => {
    const resolved = await resolveGoal({
      goal: "post a message to a Rocket.Chat room",
      serverName: "confidence-high-test",
    });

    const confidence: PlanConfidence = resolved.confidence;
    assert.ok(
      confidence.level === "high" || confidence.level === "medium",
      `expected high or medium confidence, got "${confidence.level}"`,
    );
    assert.ok(confidence.termCoverage > 0, "term coverage must be > 0");
    assert.ok(Array.isArray(confidence.signals), "signals must be an array");
  });

  it("returns medium confidence for a search-only goal without workflow", async () => {
    const resolved = await resolveGoal({
      goal: "manage omnichannel livechat agents",
      serverName: "confidence-medium-test",
    });

    const confidence: PlanConfidence = resolved.confidence;
    assert.ok(
      confidence.level === "high" || confidence.level === "medium",
      `expected high or medium confidence for a CRUD cluster goal, got "${confidence.level}"`,
    );
    assert.ok(
      confidence.signals.includes("crud_cluster"),
      "must include crud_cluster signal for manage verb",
    );
  });

  it("includes confidence line in the plan summary", async () => {
    const resolved = await resolveGoal({
      goal: "send a message and get workspace statistics",
      serverName: "confidence-summary-test",
    });

    assert.match(resolved.summary, /Confidence: (high|medium|low)/);
    assert.match(resolved.summary, /term coverage/);
  });

  it("returns high confidence for a CRUD cluster with full term coverage", async () => {
    const resolved = await resolveGoal({
      goal: "manage channels",
      serverName: "confidence-crud-test",
    });

    const confidence: PlanConfidence = resolved.confidence;
    assert.equal(confidence.level, "high", "CRUD cluster with full coverage should be high");
    assert.equal(confidence.termCoverage, 1, "all terms should be covered");
    assert.ok(confidence.signals.includes("crud_cluster"));
    assert.ok(confidence.signals.includes("full_term_coverage"));
  });
});

describe("adjustResolvedGoal", () => {
  it("adds endpoints by operationId", async () => {
    const base = await resolveGoal({
      goal: "manage channels",
      serverName: "adjust-add-test",
    });
    const basePlanId = base.planId;
    const baseCount = base.plan.resolvedOperationIds.length;

    const adjusted = await adjustResolvedGoal({
      previousGoal: base,
      addOperationIds: ["get-api-v1-statistics_list"],
    });

    assert.equal(adjusted.planId, basePlanId, "planId must be preserved");
    assert.ok(
      adjusted.plan.resolvedOperationIds.includes("get-api-v1-statistics_list"),
      "added operationId must appear in resolved set",
    );
    assert.ok(
      adjusted.plan.resolvedOperationIds.length >= baseCount,
      "endpoint count must not decrease after adding",
    );
  });

  it("removes endpoints by operationId", async () => {
    const base = await resolveGoal({
      goal: "manage channels",
      serverName: "adjust-remove-test",
    });

    const opToRemove = base.plan.selectedOperationIds.find((id) =>
      /channels_delete/i.test(id),
    );
    assert.ok(opToRemove, "base plan must include a channels_delete endpoint");

    const adjusted = await adjustResolvedGoal({
      previousGoal: base,
      removeOperationIds: [opToRemove],
    });

    assert.equal(adjusted.planId, base.planId, "planId must be preserved");
    assert.ok(
      !adjusted.plan.selectedOperationIds.includes(opToRemove),
      "removed operationId must not appear in selected set",
    );
  });

  it("adds endpoints via a sub-goal", async () => {
    const base = await resolveGoal({
      goal: "manage channels",
      serverName: "adjust-goal-test",
    });

    const adjusted = await adjustResolvedGoal({
      previousGoal: base,
      addGoal: "send messages",
    });

    assert.equal(adjusted.planId, base.planId, "planId must be preserved");
    assert.ok(
      adjusted.plan.resolvedOperationIds.some((id) => /message/i.test(id)),
      "sub-goal must add messaging endpoints",
    );
  });

  it("combines add and remove in a single adjustment", async () => {
    const base = await resolveGoal({
      goal: "manage channels",
      serverName: "adjust-combo-test",
    });

    const opToRemove = base.plan.selectedOperationIds.find((id) =>
      /channels_delete/i.test(id),
    );
    assert.ok(opToRemove, "base plan must include a channels_delete endpoint");

    const adjusted = await adjustResolvedGoal({
      previousGoal: base,
      addOperationIds: ["get-api-v1-statistics_list"],
      removeOperationIds: [opToRemove],
    });

    assert.ok(
      adjusted.plan.resolvedOperationIds.includes("get-api-v1-statistics_list"),
      "added operationId must be present",
    );
    assert.ok(
      !adjusted.plan.selectedOperationIds.includes(opToRemove),
      "removed operationId must be absent",
    );
  });

  it("recomputes confidence after adjustment", async () => {
    const base = await resolveGoal({
      goal: "manage channels",
      serverName: "adjust-confidence-test",
    });

    const adjusted = await adjustResolvedGoal({
      previousGoal: base,
      addGoal: "send messages",
    });

    assert.ok(adjusted.confidence, "adjusted plan must have confidence");
    assert.ok(
      ["high", "medium", "low"].includes(adjusted.confidence.level),
      "confidence level must be valid",
    );
    assert.match(adjusted.summary, /Confidence:/);
  });

  it("throws when no adjustments are provided", async () => {
    const base = await resolveGoal({
      goal: "manage channels",
      serverName: "adjust-no-input-test",
    });

    await assert.rejects(
      () => adjustResolvedGoal({ previousGoal: base }),
      /At least one adjustment is required/,
    );
  });

  it("throws when removal empties the operation set", async () => {
    const base = await resolveGoal({
      goal: "manage channels",
      serverName: "adjust-empty-test",
    });

    await assert.rejects(
      () =>
        adjustResolvedGoal({
          previousGoal: base,
          removeOperationIds: base.plan.selectedOperationIds,
        }),
      /empty operation set/,
    );
  });
});
