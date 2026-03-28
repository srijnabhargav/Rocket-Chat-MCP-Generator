import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface GeminiServerEntry {
  command: string;
  args: string[];
  cwd: string;
}

export interface RegisterGeminiServerInput {
  serverName: string;
  projectDir: string;
  scope?: "project" | "global";
  workspaceDir?: string;
  installDependencies?: boolean;
  /** Override for testing -- replaces os.homedir(). */
  _homeDir?: string;
}

export interface RegisterGeminiServerResult {
  settingsPath: string;
  created: boolean;
  dependenciesInstalled: boolean;
}

export function buildGeminiServerEntry(projectDir: string): GeminiServerEntry {
  return {
    command: "npm",
    args: ["start"],
    cwd: resolve(projectDir),
  };
}

function resolveSettingsPath(input: RegisterGeminiServerInput): string {
  const scope = input.scope ?? "project";
  if (scope === "global") {
    const home = input._homeDir ?? homedir();
    return join(home, ".gemini", "settings.json");
  }
  const workspace = input.workspaceDir ?? process.cwd();
  return join(resolve(workspace), ".gemini", "settings.json");
}

export function installProjectDependencies(projectDir: string): void {
  const resolved = resolve(projectDir);
  if (!existsSync(join(resolved, "package.json"))) {
    throw new Error(`No package.json found in "${resolved}".`);
  }
  execSync("npm install --no-audit --no-fund", {
    cwd: resolved,
    stdio: "pipe",
    timeout: 120_000,
  });
}

export function registerGeminiServer(
  input: RegisterGeminiServerInput,
): RegisterGeminiServerResult {
  const settingsPath = resolveSettingsPath(input);
  const created = !existsSync(settingsPath);

  let settings: Record<string, unknown> = {};
  if (!created) {
    const raw = readFileSync(settingsPath, "utf-8");
    settings = JSON.parse(raw) as Record<string, unknown>;
  }

  const mcpServers =
    (settings.mcpServers as Record<string, unknown> | undefined) ?? {};
  const newEntry = buildGeminiServerEntry(input.projectDir);
  const newCwd = newEntry.cwd;
  for (const [name, entry] of Object.entries(mcpServers)) {
    if (
      name !== input.serverName &&
      typeof entry === "object" &&
      entry !== null &&
      (entry as Record<string, unknown>).cwd === newCwd
    ) {
      delete mcpServers[name];
    }
  }
  mcpServers[input.serverName] = newEntry;
  settings.mcpServers = mcpServers;

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");

  let dependenciesInstalled = false;
  if (input.installDependencies !== false) {
    const nodeModulesPath = join(resolve(input.projectDir), "node_modules");
    if (!existsSync(nodeModulesPath)) {
      installProjectDependencies(input.projectDir);
      dependenciesInstalled = true;
    }
  }

  return { settingsPath, created, dependenciesInstalled };
}
