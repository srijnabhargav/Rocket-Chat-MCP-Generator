import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildGeminiServerEntry,
  installProjectDependencies,
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
      installDependencies: false,
    });

    assert.equal(result.created, true);
    assert.equal(result.dependenciesInstalled, false);
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
      installDependencies: false,
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
      installDependencies: false,
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
      installDependencies: false,
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
      installDependencies: false,
    });

    const result = registerGeminiServer({
      serverName: "my-server",
      projectDir: "/tmp/new-path",
      scope: "project",
      workspaceDir: workspace,
      installDependencies: false,
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

  it("installs dependencies when node_modules is missing", () => {
    const workspace = makeTempDir();
    const projectDir = makeTempDir();
    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify({
        name: "test-install",
        version: "1.0.0",
        dependencies: { "is-number": "^7.0.0" },
      }),
      "utf-8",
    );

    const result = registerGeminiServer({
      serverName: "install-test",
      projectDir,
      scope: "project",
      workspaceDir: workspace,
    });

    assert.equal(result.dependenciesInstalled, true);
    assert.ok(existsSync(join(projectDir, "node_modules")));

    rmSync(workspace, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("skips npm install when node_modules already exists", () => {
    const workspace = makeTempDir();
    const projectDir = makeTempDir();
    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify({ name: "test-skip", version: "1.0.0" }),
      "utf-8",
    );
    mkdirSync(join(projectDir, "node_modules"), { recursive: true });

    const result = registerGeminiServer({
      serverName: "skip-install-test",
      projectDir,
      scope: "project",
      workspaceDir: workspace,
    });

    assert.equal(result.dependenciesInstalled, false);

    rmSync(workspace, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });
});

describe("installProjectDependencies", () => {
  it("throws when package.json is missing", () => {
    const emptyDir = makeTempDir();
    assert.throws(
      () => installProjectDependencies(emptyDir),
      /No package\.json found/,
    );
    rmSync(emptyDir, { recursive: true, force: true });
  });
});
