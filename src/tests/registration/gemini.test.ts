import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildGeminiServerEntry,
  registerGeminiServer,
} from "../../registration/index.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "gemini-reg-test-"));
}

describe("buildGeminiServerEntry", () => {
  it("returns an npm start entry with the resolved project path", () => {
    const entry = buildGeminiServerEntry("/tmp/my-server");
    assert.equal(entry.command, "npm");
    assert.deepEqual(entry.args, ["start"]);
    assert.equal(entry.cwd, "/tmp/my-server");
  });
});

describe("registerGeminiServer", () => {
  it("creates settings.json from scratch when it does not exist", () => {
    const workspace = makeTempDir();
    const result = registerGeminiServer({
      serverName: "test-server",
      projectDir: "/tmp/generated-project",
      scope: "project",
      workspaceDir: workspace,
    });

    assert.equal(result.created, true);
    assert.ok(existsSync(result.settingsPath));

    const settings = JSON.parse(readFileSync(result.settingsPath, "utf-8"));
    assert.deepEqual(settings.mcpServers["test-server"], {
      command: "npm",
      args: ["start"],
      cwd: "/tmp/generated-project",
    });

    rmSync(workspace, { recursive: true, force: true });
  });

  it("merges into existing settings.json preserving other entries", () => {
    const workspace = makeTempDir();
    const geminiDir = join(workspace, ".gemini");
    mkdirSync(geminiDir, { recursive: true });
    const settingsPath = join(geminiDir, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        theme: "dark",
        mcpServers: {
          "existing-server": {
            command: "node",
            args: ["index.js"],
            cwd: "/other/project",
          },
        },
      }),
      "utf-8",
    );

    const result = registerGeminiServer({
      serverName: "new-server",
      projectDir: "/tmp/new-project",
      scope: "project",
      workspaceDir: workspace,
    });

    assert.equal(result.created, false);

    const settings = JSON.parse(readFileSync(result.settingsPath, "utf-8"));
    assert.equal(settings.theme, "dark", "non-mcpServers keys must be preserved");
    assert.deepEqual(settings.mcpServers["existing-server"], {
      command: "node",
      args: ["index.js"],
      cwd: "/other/project",
    });
    assert.deepEqual(settings.mcpServers["new-server"], {
      command: "npm",
      args: ["start"],
      cwd: "/tmp/new-project",
    });

    rmSync(workspace, { recursive: true, force: true });
  });

  it("writes to the workspace .gemini directory for project scope", () => {
    const workspace = makeTempDir();
    const result = registerGeminiServer({
      serverName: "proj-server",
      projectDir: "/tmp/proj",
      scope: "project",
      workspaceDir: workspace,
    });

    const expected = join(workspace, ".gemini", "settings.json");
    assert.equal(result.settingsPath, expected);
    assert.ok(existsSync(expected));

    rmSync(workspace, { recursive: true, force: true });
  });

  it("writes to the home .gemini directory for global scope", () => {
    const fakeHome = makeTempDir();
    const result = registerGeminiServer({
      serverName: "global-server",
      projectDir: "/tmp/global-proj",
      scope: "global",
      _homeDir: fakeHome,
    });

    const expected = join(fakeHome, ".gemini", "settings.json");
    assert.equal(result.settingsPath, expected);
    assert.ok(existsSync(expected));

    const settings = JSON.parse(readFileSync(expected, "utf-8"));
    assert.deepEqual(settings.mcpServers["global-server"], {
      command: "npm",
      args: ["start"],
      cwd: "/tmp/global-proj",
    });

    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("overwrites an existing entry for the same server name", () => {
    const workspace = makeTempDir();

    registerGeminiServer({
      serverName: "my-server",
      projectDir: "/tmp/old-path",
      scope: "project",
      workspaceDir: workspace,
    });

    const result = registerGeminiServer({
      serverName: "my-server",
      projectDir: "/tmp/new-path",
      scope: "project",
      workspaceDir: workspace,
    });

    assert.equal(result.created, false);

    const settings = JSON.parse(readFileSync(result.settingsPath, "utf-8"));
    assert.equal(
      settings.mcpServers["my-server"].cwd,
      "/tmp/new-path",
      "cwd must be updated to the new path",
    );

    rmSync(workspace, { recursive: true, force: true });
  });
});
