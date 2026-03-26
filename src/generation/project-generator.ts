import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type FullEndpoint,
  type GeneratedProjectManifest,
  type GenerationPlan,
  type WorkflowDefinition,
  type WorkflowInputMapping,
  type WorkflowStepDefinition,
} from "../domain/index.js";
import { getWorkflowByName } from "../discovery/index.js";
import {
  extensionFilesForMode,
  type GeneratedToolDescriptor,
  generateWorkflowToolFile,
  generateWorkflowToolTest,
  generateEnvExample,
  generateGeneratedPackageJson,
  generateGeneratedTsConfig,
  generateRcClient,
  generateReadme,
  generateServerEntry,
  generateServerTest,
  generateTestSetup,
  generateToolFile,
  generateToolIndex,
  generateToolTest,
} from "./templates.js";

interface WorkflowGenerationTarget {
  definition: WorkflowDefinition;
  steps: WorkflowGenerationStepTarget[];
  fileName: string;
  toolName: string;
}

interface WorkflowGenerationStepTarget {
  id: string;
  endpoint: FullEndpoint;
  inputMappings: WorkflowInputMapping[];
}

function buildToolDescriptors(
  endpoints: FullEndpoint[],
  workflows: WorkflowGenerationTarget[],
): GeneratedToolDescriptor[] {
  return [
    ...endpoints.map((endpoint) => ({
      fileName: endpoint.operationId,
      toolName: endpoint.operationId,
      description: endpoint.summary || endpoint.description,
      method: endpoint.method,
      path: endpoint.path,
    })),
    ...workflows.map((workflow) => ({
      fileName: workflow.fileName,
      toolName: workflow.toolName,
      description: workflow.definition.description,
      method: "WORKFLOW",
      path: workflow.steps.map((step) => step.endpoint.operationId).join(" -> "),
    })),
  ];
}

function resolveWorkflowStepTargets(input: {
  steps: WorkflowStepDefinition[];
  endpointMap: Map<string, FullEndpoint>;
}): WorkflowGenerationStepTarget[] | null {
  const resolvedSteps: WorkflowGenerationStepTarget[] = [];

  for (const step of input.steps) {
    const endpoint = input.endpointMap.get(step.operationId);
    if (!endpoint) {
      return null;
    }
    resolvedSteps.push({
      id: step.id,
      endpoint,
      inputMappings: step.inputMappings,
    });
  }

  return resolvedSteps;
}

function resolveWorkflowTargets(
  plan: GenerationPlan,
  endpoints: FullEndpoint[],
): WorkflowGenerationTarget[] {
  const endpointMap = new Map(
    endpoints.map((endpoint) => [endpoint.operationId, endpoint]),
  );

  return plan.selectedWorkflows.flatMap((workflowName) => {
    const definition = getWorkflowByName(workflowName);
    if (!definition) {
      return [];
    }

    const steps = resolveWorkflowStepTargets({
      steps: definition.steps,
      endpointMap,
    });
    if (!steps || steps.length === 0) {
      return [];
    }

    return [
      {
        definition,
        steps,
        fileName: `workflow_${definition.name}`,
        toolName: `workflow_${definition.name}`,
      },
    ];
  });
}

export function generateProjectFiles(
  plan: GenerationPlan,
  endpoints: FullEndpoint[],
): Record<string, string> {
  const workflowTargets = resolveWorkflowTargets(plan, endpoints);
  const toolDescriptors = buildToolDescriptors(endpoints, workflowTargets);

  const files: Record<string, string> = {
    "src/server.ts": generateServerEntry(plan.serverName, toolDescriptors.length),
    "src/rc-client.ts": generateRcClient(),
    "src/tools/index.ts": generateToolIndex(toolDescriptors),
    "src/tests/setup.ts": generateTestSetup(),
    "src/tests/server.test.ts": generateServerTest(toolDescriptors),
    "package.json": generateGeneratedPackageJson(plan.serverName),
    "tsconfig.json": generateGeneratedTsConfig(),
    ".env.example": generateEnvExample(),
    "README.md": generateReadme(plan.serverName, toolDescriptors),
    ...extensionFilesForMode(plan.serverName, plan.outputMode),
  };

  for (const endpoint of endpoints) {
    files[`src/tools/${endpoint.operationId}.ts`] = generateToolFile(endpoint);
    files[`src/tests/${endpoint.operationId}.test.ts`] = generateToolTest(endpoint);
  }

  for (const workflow of workflowTargets) {
    files[`src/tools/${workflow.fileName}.ts`] = generateWorkflowToolFile({
      fileName: workflow.fileName,
      toolName: workflow.toolName,
      description: workflow.definition.description,
      steps: workflow.steps,
    });
    files[`src/tests/${workflow.fileName}.test.ts`] = generateWorkflowToolTest({
      fileName: workflow.fileName,
      toolName: workflow.toolName,
      description: workflow.definition.description,
      steps: workflow.steps,
    });
  }

  return files;
}

export function writeGeneratedProject(input: {
  outputDir: string;
  plan: GenerationPlan;
  endpoints: FullEndpoint[];
}): GeneratedProjectManifest {
  const projectDir = resolve(input.outputDir);
  const files = generateProjectFiles(input.plan, input.endpoints);

  mkdirSync(join(projectDir, "src", "tools"), { recursive: true });
  mkdirSync(join(projectDir, "src", "tests"), { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    writeFileSync(join(projectDir, relativePath), content, "utf-8");
  }

  return {
    serverName: input.plan.serverName,
    projectDir,
    filePaths: Object.keys(files),
    toolCount: Object.keys(files).filter(
      (path) => path.startsWith("src/tools/") && path !== "src/tools/index.ts",
    ).length,
  };
}
