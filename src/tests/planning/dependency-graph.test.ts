import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDependencyGraph,
  groupCapabilities,
  resolveEndpointDependencies,
} from "../../planning/index.js";
import {
  channelsListEndpoint,
  postMessageEndpoint,
} from "../fixtures/endpoints.js";

describe("dependency graph planning", () => {
  it("auto-adds prerequisite endpoints from schema connections", () => {
    const graph = buildDependencyGraph([
      channelsListEndpoint,
      postMessageEndpoint,
    ]);
    const resolution = resolveEndpointDependencies(
      [postMessageEndpoint.operationId],
      graph,
    );

    assert.ok(resolution.required.includes(channelsListEndpoint.operationId));
    assert.ok(
      resolution.dataFlows.some(
        (flow) =>
          flow.from.operationId === channelsListEndpoint.operationId &&
          flow.to.operationId === postMessageEndpoint.operationId,
      ),
    );
  });

  it("groups linked endpoints into a composed capability", () => {
    const graph = buildDependencyGraph([
      channelsListEndpoint,
      postMessageEndpoint,
    ]);
    const capabilities = groupCapabilities({
      endpointIds: [
        channelsListEndpoint.operationId,
        postMessageEndpoint.operationId,
      ],
      preferredOperationIds: [postMessageEndpoint.operationId],
      graph,
    });

    assert.equal(capabilities.length, 1);
    assert.equal(capabilities[0]?.isComposed, true);
    assert.equal(capabilities[0]?.primaryEndpoint, postMessageEndpoint.operationId);
    assert.ok(
      capabilities[0]?.prerequisites.includes(channelsListEndpoint.operationId),
    );
    assert.ok(
      capabilities[0]?.steps.some(
        (step) =>
          step.operationId === postMessageEndpoint.operationId &&
          step.inputMappings.some(
            (mapping) => mapping.targetPath === "requestBody.roomId",
          ),
      ),
    );
  });
});
