import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import {
  buildDependencyGraph,
  buildGenerationPlan,
  groupCapabilities,
} from "../../planning/index.js";
import {
  generateProjectFiles,
  writeGeneratedProject,
} from "../../generation/project-generator.js";
import {
  channelsInfoEndpoint,
  channelsListEndpoint,
  loginEndpoint,
  postMessageEndpoint,
  statisticsEndpoint,
} from "../fixtures/endpoints.js";

describe("generateProjectFiles", () => {
  it("generates the core MCP project files", () => {
    const plan = buildGenerationPlan({
      serverName: "stats-server",
      endpoints: [statisticsEndpoint],
      selectedOperationIds: [statisticsEndpoint.operationId],
    });

    const files = generateProjectFiles(plan, [statisticsEndpoint]);

    assert.ok(files["src/server.ts"]);
    assert.ok(files["src/rc-client.ts"]);
    assert.ok(files["src/tools/index.ts"]);
    assert.ok(files["src/tools/get-api-v1-statistics.ts"]);
    assert.ok(files["src/tests/server.test.ts"]);
    assert.ok(files["src/tests/get-api-v1-statistics.test.ts"]);
    assert.ok(files["package.json"]);
    assert.ok(files["README.md"]);
    assert.ok(!files["gemini-extension.json"]);
  });

  it("adds extension assets in extension output mode", () => {
    const plan = buildGenerationPlan({
      serverName: "extension-server",
      outputMode: "mcp-server-extension",
      endpoints: [statisticsEndpoint, loginEndpoint],
      selectedOperationIds: [
        statisticsEndpoint.operationId,
        loginEndpoint.operationId,
      ],
    });

    const files = generateProjectFiles(plan, [statisticsEndpoint, loginEndpoint]);

    assert.ok(files["gemini-extension.json"]);
    assert.ok(files["GEMINI.md"]);
  });

  it("generates workflow-backed tool files alongside endpoint tools", () => {
    const plan = buildGenerationPlan({
      serverName: "workflow-server",
      endpoints: [statisticsEndpoint, channelsInfoEndpoint, postMessageEndpoint, loginEndpoint],
      selectedOperationIds: [],
      selectedWorkflows: ["send_alerts_from_statistics"],
      resolvedWorkflowOperationIds: [
        statisticsEndpoint.operationId,
        channelsInfoEndpoint.operationId,
        postMessageEndpoint.operationId,
      ],
    });

    const files = generateProjectFiles(plan, [
      statisticsEndpoint,
      channelsInfoEndpoint,
      postMessageEndpoint,
      loginEndpoint,
    ]);

    assert.ok(files["src/tools/get-api-v1-statistics.ts"]);
    assert.ok(files["src/tools/post-api-v1-chat_postMessage.ts"]);
    assert.ok(files["src/tools/workflow_send_alerts_from_statistics.ts"]);
    assert.ok(files["src/tests/workflow_send_alerts_from_statistics.test.ts"]);
    assert.match(files["src/tools/index.ts"], /workflow_send_alerts_from_statistics/);
    assert.match(files["src/tests/server.test.ts"], /workflow_send_alerts_from_statistics/);
    assert.match(
      files["src/tools/workflow_send_alerts_from_statistics.ts"],
      /setValueAtPath/,
    );
    assert.match(
      files["src/tools/workflow_send_alerts_from_statistics.ts"],
      /fetch_statistics/,
    );
    assert.match(
      files["src/tools/workflow_send_alerts_from_statistics.ts"],
      /requestBody\.text/,
    );
    assert.match(
      files["src/tests/workflow_send_alerts_from_statistics.test.ts"],
      /queueResponse/,
    );
    assert.match(files["README.md"], /WORKFLOW/);
  });

  it("writes directly to outputDir and reports only generated tools", () => {
    const outputDir = mkdtempSync(join(tmpdir(), "rocket-chat-generator-"));

    try {
      const plan = buildGenerationPlan({
        serverName: "stats-server",
        endpoints: [statisticsEndpoint, loginEndpoint],
        selectedOperationIds: [
          statisticsEndpoint.operationId,
          loginEndpoint.operationId,
        ],
      });

      const manifest = writeGeneratedProject({
        outputDir,
        plan,
        endpoints: [statisticsEndpoint, loginEndpoint],
      });

      assert.equal(manifest.projectDir, resolve(outputDir));
      assert.equal(manifest.toolCount, 2);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it("generates login tool with startup auth note in description", () => {
    const plan = buildGenerationPlan({
      serverName: "auth-server",
      endpoints: [loginEndpoint, channelsInfoEndpoint],
      selectedOperationIds: [loginEndpoint.operationId, channelsInfoEndpoint.operationId],
    });

    const files = generateProjectFiles(plan, [loginEndpoint, channelsInfoEndpoint]);
    const loginToolFile = files["src/tools/post-api-v1-login.ts"];

    assert.ok(loginToolFile, "Login tool file must be generated");
    assert.match(
      loginToolFile,
      /already authenticates at startup/,
      "Login tool description must mention that auth is handled at startup",
    );
  });

  it("exposes all endpoints as standalone tools alongside capabilities", () => {
    const graph = buildDependencyGraph([
      channelsListEndpoint,
      postMessageEndpoint,
      loginEndpoint,
    ]);
    const capabilities = groupCapabilities({
      endpointIds: [
        channelsListEndpoint.operationId,
        postMessageEndpoint.operationId,
      ],
      preferredOperationIds: [postMessageEndpoint.operationId],
      graph,
    });
    const plan = buildGenerationPlan({
      serverName: "capability-server",
      endpoints: [channelsListEndpoint, postMessageEndpoint, loginEndpoint],
      selectedOperationIds: [postMessageEndpoint.operationId],
      capabilities,
    });

    const files = generateProjectFiles(plan, [
      channelsListEndpoint,
      postMessageEndpoint,
      loginEndpoint,
    ]);

    assert.ok(files["src/tools/post_message.ts"]);
    assert.ok(files["src/tools/post-api-v1-chat_postMessage.ts"]);
    assert.ok(files["src/tests/post-api-v1-chat_postMessage.test.ts"]);
    assert.match(files["src/tools/index.ts"], /post_message/);
    assert.match(files["src/tools/index.ts"], /post-api-v1-chat_postMessage/);
  });
});
