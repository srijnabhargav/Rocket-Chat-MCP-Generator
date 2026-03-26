import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { ValidationReport } from "../domain/index.js";

const REQUIRED_FILES = [
  "package.json",
  "tsconfig.json",
  "src/server.ts",
  "src/rc-client.ts",
  ".env.example",
];

export function validateGeneratedProject(projectDir: string): ValidationReport {
  const missingFiles = REQUIRED_FILES.filter(
    (relativePath) => !existsSync(resolve(projectDir, relativePath)),
  );
  const toolsDir = resolve(projectDir, "src/tools");
  const testsDir = resolve(projectDir, "src/tests");

  const toolFiles = existsSync(toolsDir)
    ? readdirSync(toolsDir).filter((fileName) => fileName.endsWith(".ts"))
    : [];
  const testFiles = existsSync(testsDir)
    ? readdirSync(testsDir).filter((fileName) => fileName.endsWith(".test.ts"))
    : [];

  return {
    projectDir,
    missingFiles,
    toolFiles,
    testFiles,
    isValid: missingFiles.length === 0 && toolFiles.length > 0,
  };
}
