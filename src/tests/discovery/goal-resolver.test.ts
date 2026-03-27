import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveGoal } from "../../discovery/index.js";

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
});
