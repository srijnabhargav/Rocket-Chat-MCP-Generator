import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  listWorkflows,
  searchEndpoints,
  suggestEndpoints,
} from "../../discovery/index.js";

describe("discovery layer", () => {
  it("lists predefined workflows", () => {
    const workflows = listWorkflows();
    const mappedWorkflow = workflows.find(
      (workflow) => workflow.name === "send_alerts_from_statistics",
    );

    assert.ok(workflows.length > 0);
    assert.ok(
      workflows.some((workflow) => workflow.name === "send_channel_message"),
    );
    assert.ok(mappedWorkflow);
    assert.equal(mappedWorkflow.steps[0]?.id, "fetch_statistics");
    assert.equal(mappedWorkflow.steps[1]?.id, "lookup_channel");
    const alertStep = mappedWorkflow.steps.find((s) => s.id === "post_alert");
    assert.ok(alertStep, "must include a post_alert step");
    assert.equal(
      alertStep.inputMappings[0]?.targetPath,
      "requestBody.text",
    );
  });

  it("searches endpoints using real Rocket.Chat specs", async () => {
    const results = await searchEndpoints({
      query: "workspace metrics",
      limit: 5,
    });

    assert.ok(results.length > 0);
    assert.equal(results[0]?.domain, "statistics");
    assert.match(results[0]?.operationId ?? "", /statistics/i);
  });

  it("suggests grouped endpoints from a natural-language goal", async () => {
    const suggestions = await suggestEndpoints({
      goal: "send alert messages from statistics",
      limit: 5,
    });

    assert.ok(suggestions.length > 0);
    assert.ok(
      suggestions.some((suggestion) =>
        suggestion.domains.includes("messaging") &&
        suggestion.domains.includes("statistics"),
      ),
    );
    assert.ok(
      suggestions.some((suggestion) =>
        suggestion.workflowNames?.includes("send_alerts_from_statistics"),
      ),
    );
    assert.ok(
      suggestions.some((suggestion) => suggestion.confidence === "high"),
    );
    assert.ok(
      suggestions.some((suggestion) => suggestion.matchedTerms.includes("alert")),
    );
  });

  it("suggests workflow-friendly bundles for cross-domain goals", async () => {
    const suggestions = await suggestEndpoints({
      goal: "invite team members to a new channel",
      limit: 5,
    });

    assert.ok(suggestions.length > 0);
    assert.ok(
      suggestions.some((suggestion) =>
        suggestion.workflowNames?.includes("create_channel_and_invite_members"),
      ),
    );
    assert.ok(
      suggestions.some((suggestion) =>
        suggestion.domains.includes("rooms") &&
        suggestion.domains.includes("user-management"),
      ),
    );
  });
});
