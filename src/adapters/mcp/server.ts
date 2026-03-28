import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  adjustResolvedGoal,
  listWorkflows,
  resolveGoal,
  searchEndpoints,
  suggestEndpoints,
  type ResolvedGoal,
} from "../../discovery/index.js";
import {
  VALID_DOMAINS,
  type Domain,
  type FullEndpoint,
  type OutputMode,
} from "../../domain/index.js";
import { writeGeneratedProject } from "../../generation/index.js";
import {
  buildGenerationPlan,
  resolveWorkflowSelections,
} from "../../planning/index.js";
import {
  discoverEndpoints,
  getAvailableDomains,
  getEndpointsByIds,
} from "../../specs/index.js";
import { registerGeminiServer } from "../../registration/index.js";
import {
  analyzeMinimality,
  validateGeneratedProject,
} from "../../validation/index.js";

const server = new McpServer({
  name: "rocket-chat-mcp-generator",
  version: "0.1.0",
});
const resolvedPlanStore = new Map<string, ResolvedGoal>();

function isValidDomain(value: string): value is Domain {
  return VALID_DOMAINS.includes(value as Domain);
}

async function resolvePlan(input: {
  operationIds: string[];
  workflows?: string[];
  serverName?: string;
  outputMode?: OutputMode;
}): Promise<{ plan: ReturnType<typeof buildGenerationPlan>; endpoints: FullEndpoint[] }> {
  const workflowResolution = resolveWorkflowSelections(input.workflows ?? []);
  const mergedOperationIds = [
    ...new Set([...input.operationIds, ...workflowResolution.resolvedWorkflowOperationIds]),
  ];
  const initialEndpoints = await getEndpointsByIds(mergedOperationIds);
  const plan = buildGenerationPlan({
    serverName: input.serverName,
    outputMode: input.outputMode,
    endpoints: initialEndpoints,
    selectedOperationIds: input.operationIds,
    selectedWorkflows: workflowResolution.selectedWorkflows,
    resolvedWorkflowOperationIds: workflowResolution.resolvedWorkflowOperationIds,
    warnings: workflowResolution.warnings,
  });
  const endpoints = await getEndpointsByIds(plan.resolvedOperationIds);

  return { plan, endpoints };
}

function formatWarnings(
  warnings: ReturnType<typeof buildGenerationPlan>["warnings"],
): string[] {
  return warnings.length > 0
    ? [
        "Warnings:",
        ...warnings.map((warning) => {
          const details =
            warning.details && warning.details.length > 0
              ? ` (${warning.details.join(", ")})`
              : "";
          return `  - [${warning.code}] ${warning.message}${details}`;
        }),
      ]
    : [];
}

server.registerTool(
  "resolve_goal",
  {
    description:
      "Analyze a natural-language goal and produce a ready-to-confirm generation plan with capabilities and resolved endpoints.",
    inputSchema: {
      goal: z
        .string()
        .describe("What the generated Rocket.Chat MCP server should do, in the user's own words."),
      serverName: z
        .string()
        .optional()
        .describe("Optional name for the generated server."),
      outputMode: z
        .enum(["mcp-server", "mcp-server-extension"])
        .optional()
        .describe("Generated output mode."),
    },
  },
  async ({ goal, serverName, outputMode }) => {
    try {
      const resolved = await resolveGoal({
        goal,
        serverName,
        outputMode: outputMode as OutputMode | undefined,
      });
      resolvedPlanStore.set(resolved.planId, resolved);

      return {
        content: [
          {
            type: "text" as const,
            text: [
              resolved.summary,
              "",
              `To generate this server, call generate_from_plan with planId "${resolved.planId}".`,
              ...formatWarnings(resolved.plan.warnings),
            ].join("\n"),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Goal resolution failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "adjust_plan",
  {
    description:
      "Adjust a previously resolved plan by adding/removing endpoints or appending a new sub-goal. The plan is rebuilt in-place under the same planId.",
    inputSchema: {
      planId: z
        .string()
        .describe("Plan ID returned by resolve_goal."),
      addOperationIds: z
        .array(z.string())
        .optional()
        .describe("Rocket.Chat operationIds to add to the plan."),
      removeOperationIds: z
        .array(z.string())
        .optional()
        .describe("Rocket.Chat operationIds to remove from the plan."),
      addGoal: z
        .string()
        .optional()
        .describe("Natural-language sub-goal to resolve and merge into the existing plan."),
    },
  },
  async ({ planId, addOperationIds, removeOperationIds, addGoal }) => {
    const stored = resolvedPlanStore.get(planId);
    if (!stored) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Unknown planId "${planId}". Call resolve_goal first to create a plan.`,
          },
        ],
        isError: true,
      };
    }

    try {
      const adjusted = await adjustResolvedGoal({
        previousGoal: stored,
        addOperationIds,
        removeOperationIds,
        addGoal,
      });
      resolvedPlanStore.set(adjusted.planId, adjusted);

      return {
        content: [
          {
            type: "text" as const,
            text: [
              adjusted.summary,
              "",
              `Plan adjusted. To generate this server, call generate_from_plan with planId "${adjusted.planId}".`,
              ...formatWarnings(adjusted.plan.warnings),
            ].join("\n"),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Plan adjustment failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "discover_endpoints",
  {
    description:
      "Browse Rocket.Chat API endpoints by domain. Returns tag summaries by default and expands tags on demand.",
    inputSchema: {
      domains: z
        .array(z.string())
        .describe("Rocket.Chat API domains to browse."),
      expand: z
        .array(z.string())
        .optional()
        .describe("Tag names to expand. Use ['*'] to expand all tags."),
    },
  },
  async ({ domains, expand }) => {
    const invalidDomains = domains.filter((domain) => !isValidDomain(domain));
    if (invalidDomains.length > 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Invalid domain(s): ${invalidDomains.join(", ")}. Valid domains: ${getAvailableDomains().join(", ")}`,
          },
        ],
        isError: true,
      };
    }

    try {
      const endpoints = await discoverEndpoints(domains as Domain[]);
      const grouped = new Map<string, Map<string, typeof endpoints>>();
      for (const endpoint of endpoints) {
        const byTag = grouped.get(endpoint.domain) ?? new Map();
        const tagGroup = byTag.get(endpoint.tag) ?? [];
        tagGroup.push(endpoint);
        byTag.set(endpoint.tag, tagGroup);
        grouped.set(endpoint.domain, byTag);
      }

      const expandAll = expand?.includes("*") ?? false;
      const expandSet = new Set((expand ?? []).map((tag) => tag.toLowerCase()));
      const sections: string[] = [];

      for (const [domain, tags] of grouped) {
        const totalEndpoints = [...tags.values()].reduce(
          (sum, value) => sum + value.length,
          0,
        );
        const lines: string[] = [];

        for (const [tag, tagEndpoints] of tags) {
          if (expandAll || expandSet.has(tag.toLowerCase())) {
            lines.push(`  ▶ ${tag} (${tagEndpoints.length} endpoints)`);
            lines.push(
              ...tagEndpoints.map(
                (endpoint, index) =>
                  `    ${String(index + 1).padStart(3)}. ${endpoint.operationId}  ${endpoint.method.padEnd(6)} — ${endpoint.summary}`,
              ),
            );
          } else {
            lines.push(`  ${tag} (${tagEndpoints.length} endpoints)`);
          }
        }

        sections.push(
          `── ${domain} (${totalEndpoints} endpoints, ${tags.size} tags) ──\n${lines.join("\n")}`,
        );
      }

      return {
        content: [{ type: "text" as const, text: sections.join("\n\n") }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to discover endpoints: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "search_endpoints",
  {
    description:
      "Search Rocket.Chat endpoints by query across operationId, summary, path, and tag.",
    inputSchema: {
      query: z.string().describe("Free-text query for matching Rocket.Chat endpoints."),
      domains: z
        .array(z.string())
        .optional()
        .describe("Optional Rocket.Chat domains to search within."),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum number of results to return."),
    },
  },
  async ({ query, domains, limit }) => {
    const invalidDomains = (domains ?? []).filter((domain) => !isValidDomain(domain));
    if (invalidDomains.length > 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Invalid domain(s): ${invalidDomains.join(", ")}. Valid domains: ${getAvailableDomains().join(", ")}`,
          },
        ],
        isError: true,
      };
    }

    try {
      const results = await searchEndpoints({
        query,
        domains: domains as Domain[] | undefined,
        limit,
      });

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No endpoints matched "${query}".`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Search results for "${query}" (${results.length}):`,
              "",
              ...results.map(
                (result, index) =>
                  `${String(index + 1).padStart(3)}. ${result.operationId}  ${result.method.padEnd(6)} — ${result.summary} [${result.domain}/${result.tag}] score=${result.score.toFixed(2)}`,
              ),
            ].join("\n"),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "suggest_endpoints",
  {
    description:
      "Suggest a minimal set of Rocket.Chat endpoint groups from a natural-language goal.",
    inputSchema: {
      goal: z
        .string()
        .describe("Natural-language goal, such as sending alerts or managing channels."),
      domains: z
        .array(z.string())
        .optional()
        .describe("Optional Rocket.Chat domains to constrain suggestions."),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum number of grouped suggestions to return."),
    },
  },
  async ({ goal, domains, limit }) => {
    const invalidDomains = (domains ?? []).filter((domain) => !isValidDomain(domain));
    if (invalidDomains.length > 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Invalid domain(s): ${invalidDomains.join(", ")}. Valid domains: ${getAvailableDomains().join(", ")}`,
          },
        ],
        isError: true,
      };
    }

    try {
      const suggestions = await suggestEndpoints({
        goal,
        domains: domains as Domain[] | undefined,
        limit,
      });

      if (suggestions.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No endpoint suggestions matched "${goal}".`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Suggested endpoint groups for "${goal}":`,
              "",
              ...suggestions.flatMap((suggestion, index) => [
                `${index + 1}. ${suggestion.title}`,
                `   Reason: ${suggestion.reason}`,
                `   Confidence: ${suggestion.confidence}`,
                `   Matched terms: ${suggestion.matchedTerms.join(", ") || "(none)"}`,
                `   Domains: ${suggestion.domains.join(", ")}`,
                `   Workflows: ${suggestion.workflowNames?.join(", ") || "(none)"}`,
                `   OperationIds: ${suggestion.operationIds.join(", ")}`,
              ]),
            ].join("\n"),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Suggestion failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "list_workflows",
  {
    description:
      "List predefined Rocket.Chat workflow recipes that can guide endpoint selection.",
    inputSchema: {},
  },
  async () => {
    const workflows = listWorkflows();
    return {
      content: [
        {
          type: "text" as const,
          text: [
            `Available workflows (${workflows.length}):`,
            "",
            ...workflows.flatMap((workflow) => [
              `- ${workflow.name}`,
              `  ${workflow.description}`,
              `  Domains: ${workflow.domains.join(", ")}`,
              `  OperationIds: ${workflow.operationIds.join(", ")}`,
              `  Steps: ${workflow.steps
                .map((step) => {
                  const mappings =
                    step.inputMappings.length > 0
                      ? ` [maps ${step.inputMappings
                          .map(
                            (mapping) =>
                              `${mapping.targetPath} <= ${mapping.sourceStepId}.${mapping.sourcePath}`,
                          )
                          .join(", ")}]`
                      : "";
                  return `${step.id}:${step.operationId}${mappings}`;
                })
                .join(" -> ")}`,
            ]),
          ].join("\n"),
        },
      ],
    };
  },
);

server.registerTool(
  "plan_generation",
  {
    description:
      "Build a generation plan from selected Rocket.Chat operationIds before writing files.",
    inputSchema: {
      operationIds: z
        .array(z.string())
        .describe("Rocket.Chat operationIds to include."),
      workflows: z
        .array(z.string())
        .optional()
        .describe("Named workflow recipes to include in the plan."),
      serverName: z
        .string()
        .optional()
        .describe("Name for the generated server."),
      outputMode: z
        .enum(["mcp-server", "mcp-server-extension"])
        .optional()
        .describe("Generated output mode."),
    },
  },
  async ({ operationIds, workflows, serverName, outputMode }) => {
    try {
      const { plan } = await resolvePlan({
        operationIds,
        workflows,
        serverName,
        outputMode: outputMode as OutputMode | undefined,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Plan for "${plan.serverName}"`,
              `Output mode: ${plan.outputMode}`,
              `Selected operationIds: ${plan.selectedOperationIds.join(", ")}`,
              `Selected workflows: ${plan.selectedWorkflows.join(", ") || "(none)"}`,
              `Resolved workflow operationIds: ${plan.resolvedWorkflowOperationIds.join(", ") || "(none)"}`,
              `Resolved operationIds: ${plan.resolvedOperationIds.join(", ")}`,
              `Auth strategy: ${plan.authStrategy.mode}`,
              `Auth required: ${plan.authStrategy.requiresAuth ? "yes" : "no"}`,
              ...formatWarnings(plan.warnings),
            ].join("\n"),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to build generation plan: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "generate_from_plan",
  {
    description:
      "Generate a Rocket.Chat MCP server from a previously resolved plan. Call resolve_goal first.",
    inputSchema: {
      planId: z
        .string()
        .describe("Plan ID returned by resolve_goal."),
      outputDir: z
        .string()
        .describe("Directory where the generated project should be created."),
    },
  },
  async ({ planId, outputDir }) => {
    const stored = resolvedPlanStore.get(planId);
    if (!stored) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Unknown planId "${planId}". Call resolve_goal first to create a plan.`,
          },
        ],
        isError: true,
      };
    }

    try {
      const manifest = writeGeneratedProject({
        outputDir,
        plan: stored.plan,
        endpoints: stored.endpoints,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Project created at: ${manifest.projectDir}`,
              `Server name: ${manifest.serverName}`,
              `Tool count: ${manifest.toolCount}`,
              `Files written: ${manifest.filePaths.length}`,
              ...formatWarnings(stored.plan.warnings),
            ].join("\n"),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Plan-based generation failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "generate_mcp_server",
  {
    description:
      "Generate a minimal Rocket.Chat MCP server project from selected operationIds.",
    inputSchema: {
      operationIds: z
        .array(z.string())
        .describe("Rocket.Chat operationIds to include."),
      workflows: z
        .array(z.string())
        .optional()
        .describe("Named workflow recipes to include in generation."),
      serverName: z
        .string()
        .optional()
        .describe("Name for the generated server."),
      outputDir: z
        .string()
        .describe("Directory where the generated project should be created."),
      outputMode: z
        .enum(["mcp-server", "mcp-server-extension"])
        .optional()
        .describe("Generated output mode."),
    },
  },
  async ({ operationIds, workflows, outputDir, serverName, outputMode }) => {
    try {
      const { plan, endpoints } = await resolvePlan({
        operationIds,
        workflows,
        serverName,
        outputMode: outputMode as OutputMode | undefined,
      });
      const manifest = writeGeneratedProject({
        outputDir,
        plan,
        endpoints,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Project created at: ${manifest.projectDir}`,
              `Server name: ${manifest.serverName}`,
              `Tool count: ${manifest.toolCount}`,
              `Files written: ${manifest.filePaths.length}`,
              ...formatWarnings(plan.warnings),
            ].join("\n"),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Generation failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "validate_generated_server",
  {
    description: "Validate the structure of a generated Rocket.Chat MCP server project.",
    inputSchema: {
      projectDir: z.string().describe("Absolute path to the generated project."),
    },
  },
  async ({ projectDir }) => {
    const report = validateGeneratedProject(projectDir);
    return {
      content: [
        {
          type: "text" as const,
          text: [
            `Project: ${report.projectDir}`,
            `Valid: ${report.isValid ? "yes" : "no"}`,
            `Tool files: ${report.toolFiles.length}`,
            `Test files: ${report.testFiles.length}`,
            ...(report.missingFiles.length > 0
              ? ["Missing files:", ...report.missingFiles.map((file) => `  - ${file}`)]
              : []),
          ].join("\n"),
        },
      ],
      isError: !report.isValid,
    };
  },
);

server.registerTool(
  "analyze_minimality",
  {
    description:
      "Analyze how much schema and endpoint surface is removed by the selected operationIds.",
    inputSchema: {
      operationIds: z
        .array(z.string())
        .describe("Rocket.Chat operationIds to analyze."),
    },
  },
  async ({ operationIds }) => {
    try {
      const endpoints = await getEndpointsByIds(operationIds);
      const report = await analyzeMinimality(endpoints);
      return {
        content: [{ type: "text" as const, text: report }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Minimality analysis failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "register_gemini_server",
  {
    description:
      "Register a generated MCP server in Gemini CLI's settings.json so it can be used immediately. Call after generate_from_plan.",
    inputSchema: {
      serverName: z
        .string()
        .describe("Name for the server entry in Gemini CLI settings."),
      projectDir: z
        .string()
        .describe("Absolute path to the generated MCP server project."),
      scope: z
        .enum(["project", "global"])
        .optional()
        .describe(
          'Where to register: "project" writes to <workspaceDir>/.gemini/settings.json, "global" writes to ~/.gemini/settings.json. Defaults to "project".',
        ),
      workspaceDir: z
        .string()
        .optional()
        .describe(
          "Workspace root where Gemini CLI runs. Required for project scope. Defaults to the current working directory.",
        ),
    },
  },
  async ({ serverName, projectDir, scope, workspaceDir }) => {
    try {
      const result = registerGeminiServer({
        serverName,
        projectDir,
        scope: scope as "project" | "global" | undefined,
        workspaceDir,
      });

      const action = result.created ? "Created" : "Updated";
      return {
        content: [
          {
            type: "text" as const,
            text: [
              `${action} ${result.settingsPath}`,
              `Server "${serverName}" registered for Gemini CLI.`,
              `Run \`/mcp list\` in Gemini CLI to verify the connection.`,
            ].join("\n"),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Registration failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Rocket.Chat MCP generator failed to start:", error);
  process.exit(1);
});
