import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { writeGeneratedProject } from "../../generation/index.js";
import { buildGenerationPlan } from "../../planning/index.js";
import { getEndpointsByIds } from "../../specs/index.js";
import { validateGeneratedProject } from "../../validation/index.js";

const tempProjectRoot = join(tmpdir(), "rocket-chat-mcp-generator-e2e");

after(() => {
  rmSync(tempProjectRoot, { recursive: true, force: true });
});

describe("end-to-end generation", () => {
  it("generates, validates, installs, compiles, and tests a workflow-backed project from real Rocket.Chat endpoints", async () => {
    const initialEndpoints = await getEndpointsByIds([
      "get-api-v1-statistics",
      "post-api-v1-chat_postMessage",
    ]);

    assert.ok(initialEndpoints.length >= 2);

    const plan = buildGenerationPlan({
      serverName: "workflow-e2e-server",
      endpoints: initialEndpoints,
      selectedOperationIds: [],
      selectedWorkflows: ["send_alerts_from_statistics"],
      resolvedWorkflowOperationIds: initialEndpoints.map(
        (endpoint) => endpoint.operationId,
      ),
    });
    const endpoints = await getEndpointsByIds(plan.resolvedOperationIds);

    const manifest = writeGeneratedProject({
      outputDir: tempProjectRoot,
      plan,
      endpoints,
    });

    assert.ok(existsSync(join(manifest.projectDir, "src", "server.ts")));
    assert.ok(
      existsSync(
        join(
          manifest.projectDir,
          "src",
          "tools",
          "workflow_send_alerts_from_statistics.ts",
        ),
      ),
    );

    const report = validateGeneratedProject(manifest.projectDir);
    assert.equal(report.isValid, true);

    execSync("npm install", {
      cwd: manifest.projectDir,
      stdio: "pipe",
      timeout: 120000,
    });
    execSync("npx tsc --noEmit", {
      cwd: manifest.projectDir,
      stdio: "pipe",
      timeout: 120000,
    });
    execSync("npm test", {
      cwd: manifest.projectDir,
      stdio: "pipe",
      timeout: 120000,
    });
  });
});
