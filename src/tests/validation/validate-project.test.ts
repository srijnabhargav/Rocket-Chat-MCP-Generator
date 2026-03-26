import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { validateGeneratedProject } from "../../validation/index.js";

const tempDirectories: string[] = [];

after(() => {
  for (const directory of tempDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeTempProject(): string {
  const directory = mkdtempSync(join(tmpdir(), "rc-mcp-generator-validate-"));
  tempDirectories.push(directory);
  return directory;
}

describe("validateGeneratedProject", () => {
  it("reports a valid project when required files exist", () => {
    const projectDir = makeTempProject();
    mkdirSync(join(projectDir, "src", "tools"), { recursive: true });
    mkdirSync(join(projectDir, "src", "tests"), { recursive: true });
    writeFileSync(join(projectDir, "package.json"), "{}");
    writeFileSync(join(projectDir, "tsconfig.json"), "{}");
    writeFileSync(join(projectDir, "src", "server.ts"), "");
    writeFileSync(join(projectDir, "src", "rc-client.ts"), "");
    writeFileSync(join(projectDir, ".env.example"), "");
    writeFileSync(join(projectDir, "src", "tools", "sample.ts"), "");
    writeFileSync(join(projectDir, "src", "tests", "sample.test.ts"), "");

    const report = validateGeneratedProject(projectDir);

    assert.equal(report.isValid, true);
    assert.equal(report.missingFiles.length, 0);
    assert.equal(report.toolFiles.length, 1);
    assert.equal(report.testFiles.length, 1);
  });

  it("reports missing required files", () => {
    const projectDir = makeTempProject();

    const report = validateGeneratedProject(projectDir);

    assert.equal(report.isValid, false);
    assert.ok(report.missingFiles.length > 0);
  });
});
