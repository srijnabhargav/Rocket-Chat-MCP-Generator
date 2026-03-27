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
  includeEndpointTools = true,
): GeneratedToolDescriptor[] {
  return [
    ...(includeEndpointTools
      ? endpoints.map((endpoint) => ({
          fileName: endpoint.operationId,
          toolName: endpoint.operationId,
          description: endpoint.summary || endpoint.description,
          method: endpoint.method,
          path: endpoint.path,
        }))
      : []),
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

function toWorkflowGenerationTarget(input: {
  name: string;
  description: string;
  steps: WorkflowGenerationStepTarget[];
  fileName?: string;
  toolName?: string;
}): WorkflowGenerationTarget {
  return {
    definition: {
      name: input.name,
      description: input.description,
      domains: [],
      operationIds: input.steps.map((step) => step.endpoint.operationId),
      steps: input.steps.map((step) => ({
        id: step.id,
        operationId: step.endpoint.operationId,
        inputMappings: step.inputMappings,
      })),
    },
    steps: input.steps,
    fileName: input.fileName ?? `workflow_${input.name}`,
    toolName: input.toolName ?? `workflow_${input.name}`,
  };
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
      toWorkflowGenerationTarget({
        name: definition.name,
        description: definition.description,
        steps,
      }),
    ];
  });
}

function resolveCapabilityTargets(
  plan: GenerationPlan,
  endpoints: FullEndpoint[],
): WorkflowGenerationTarget[] {
  const endpointMap = new Map(
    endpoints.map((endpoint) => [endpoint.operationId, endpoint]),
  );

  return plan.capabilities.flatMap((capability) => {
    const steps = resolveWorkflowStepTargets({
      steps: capability.steps,
      endpointMap,
    });
    if (!steps || steps.length === 0) {
      return [];
    }

    return [
      toWorkflowGenerationTarget({
        name: capability.name,
        description: capability.description,
        steps,
        fileName: capability.name,
        toolName: capability.name,
      }),
    ];
  });
}

export function generateProjectFiles(
  plan: GenerationPlan,
  endpoints: FullEndpoint[],
): Record<string, string> {
  const workflowTargets = resolveWorkflowTargets(plan, endpoints);
  const capabilityTargets = resolveCapabilityTargets(plan, endpoints);
  const exposeEndpointTools = capabilityTargets.length === 0;
  const exposedTargets = capabilityTargets.length > 0 ? capabilityTargets : workflowTargets;
  const generatedTargets = [...workflowTargets, ...capabilityTargets];
  const toolDescriptors = buildToolDescriptors(
    endpoints,
    exposedTargets,
    exposeEndpointTools,
  );

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
    if (exposeEndpointTools) {
      files[`src/tests/${endpoint.operationId}.test.ts`] = generateToolTest(endpoint);
    }
  }

  for (const workflow of generatedTargets) {
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
  const workflowTargets = resolveWorkflowTargets(input.plan, input.endpoints);
  const capabilityTargets = resolveCapabilityTargets(input.plan, input.endpoints);
  const toolCount =
    capabilityTargets.length > 0
      ? capabilityTargets.length
      : input.endpoints.length + workflowTargets.length;

  mkdirSync(join(projectDir, "src", "tools"), { recursive: true });
  mkdirSync(join(projectDir, "src", "tests"), { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    writeFileSync(join(projectDir, relativePath), content, "utf-8");
  }

  return {
    serverName: input.plan.serverName,
    projectDir,
    filePaths: Object.keys(files),
    toolCount,
  };
}
