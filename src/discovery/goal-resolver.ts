import { randomUUID } from "node:crypto";
import {
  type CapabilityDefinition,
  type FullEndpoint,
  type GenerationPlan,
  type OutputMode,
  type SearchResult,
  type SuggestionResult,
} from "../domain/index.js";
import {
  buildGenerationPlan,
  buildDependencyGraph,
  groupCapabilities,
  resolveEndpointDependencies,
} from "../planning/index.js";
import { getAllFullEndpoints } from "../specs/index.js";
import { searchEndpoints, suggestEndpoints } from "./search.js";

export interface ResolvedGoal {
  planId: string;
  plan: GenerationPlan;
  endpoints: FullEndpoint[];
  capabilities: CapabilityDefinition[];
  summary: string;
  recommendedOperationIds: string[];
}

let cachedAllEndpointsPromise: Promise<FullEndpoint[]> | null = null;

async function loadAllEndpoints(): Promise<FullEndpoint[]> {
  cachedAllEndpointsPromise ??= getAllFullEndpoints();
  return cachedAllEndpointsPromise;
}

function chooseSuggestions(suggestions: SuggestionResult[]): SuggestionResult[] {
  const chosen: SuggestionResult[] = [];
  const coveredTerms = new Set<string>();
  const coveredDomains = new Set<string>();

  for (const suggestion of suggestions) {
    const addsCoverage = suggestion.matchedTerms.some((term) => !coveredTerms.has(term));
    const addsDomain = suggestion.domains.some((domain) => !coveredDomains.has(domain));
    if (chosen.length === 0 || addsCoverage || addsDomain) {
      chosen.push(suggestion);
      suggestion.matchedTerms.forEach((term) => coveredTerms.add(term));
      suggestion.domains.forEach((domain) => coveredDomains.add(domain));
    }
    if (chosen.length >= 2) {
      break;
    }
  }

  return chosen;
}

function inferPreferredMethod(goal: string): "GET" | "WRITE" {
  const normalizedGoal = goal.toLowerCase();
  if (
    /\b(send|post|create|update|edit|delete|remove|invite|add|react|report)\b/.test(
      normalizedGoal,
    )
  ) {
    return "WRITE";
  }

  return "GET";
}

function rankSearchResult(input: {
  goal: string;
  result: SearchResult;
  hintedDomains: Set<string>;
}): number {
  const searchable = [
    input.result.operationId,
    input.result.summary,
    input.result.path,
    input.result.tag,
    input.result.domain,
  ]
    .join(" ")
    .toLowerCase();
  const preferredMethod = inferPreferredMethod(input.goal);
  const normalizedGoal = input.goal.toLowerCase();
  let score = input.result.score;

  if (preferredMethod === "GET") {
    score += input.result.method === "GET" ? 30 : -15;
  } else {
    score += input.result.method === "GET" ? -10 : 30;
  }

  if (input.hintedDomains.has(input.result.domain)) {
    score += 10;
  }

  const preferredPatterns =
    preferredMethod === "GET"
      ? [/statistics/, /\blist\b/, /\binfo\b/, /\bsearch\b/, /\bget\b/]
      : [
          /postmessage/,
          /sendmessage/,
          /\bcreate\b/,
          /\bupdate\b/,
          /\bdelete\b/,
          /\binvite\b/,
          /\bpost\b/,
        ];
  const discouragedPatterns = [
    ["delete", /\bdelete\b/],
    ["update", /\bupdate\b/],
    ["react", /\breact\b/],
    ["report", /\breport\b/],
    ["follow", /\bfollow\b/],
    ["pin", /\bpin\b/],
    ["invite", /\binvite\b/],
  ] as const;

  for (const pattern of preferredPatterns) {
    if (pattern.test(searchable)) {
      score += 12;
    }
  }

  for (const [keyword, pattern] of discouragedPatterns) {
    if (!normalizedGoal.includes(keyword) && pattern.test(searchable)) {
      score -= 18;
    }
  }

  const goalTerms = normalizedGoal
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 2);
  for (const term of goalTerms) {
    if (searchable.includes(term)) {
      score += 3;
    }
  }

  return score;
}

function selectOperationIds(input: {
  goal: string;
  suggestions: SuggestionResult[];
  searchResults: SearchResult[];
}): string[] {
  const selectedSuggestions = chooseSuggestions(input.suggestions);
  const workflowSuggestion = selectedSuggestions.find(
    (suggestion) => (suggestion.workflowNames?.length ?? 0) > 0,
  );
  if (workflowSuggestion) {
    return [...new Set(workflowSuggestion.operationIds)].slice(0, 6);
  }

  const hintedDomains = new Set(
    selectedSuggestions.flatMap((suggestion) => suggestion.domains),
  );
  const rankedResults = input.searchResults
    .map((result) => ({
      result,
      score: rankSearchResult({
        goal: input.goal,
        result,
        hintedDomains,
      }),
    }))
    .sort((left, right) => right.score - left.score);
  const topResult = rankedResults[0]?.result;

  return topResult ? [topResult.operationId] : [];
}

function describeCapability(capability: CapabilityDefinition, endpointsById: Map<string, FullEndpoint>): string[] {
  const lines = [
    `${capability.name} (${capability.isComposed ? "composed" : "single"})`,
    `  Primary endpoint: ${capability.primaryEndpoint}`,
    `  Description: ${capability.description}`,
  ];

  if (capability.prerequisites.length > 0) {
    lines.push(`  Prerequisites: ${capability.prerequisites.join(", ")}`);
  }
  for (const step of capability.steps) {
    const endpoint = endpointsById.get(step.operationId);
    const summary = endpoint?.summary || step.operationId;
    const mappings =
      step.inputMappings.length > 0
        ? ` [maps ${step.inputMappings
            .map(
              (mapping) =>
                `${mapping.targetPath} <= ${mapping.sourceStepId}.${mapping.sourcePath}`,
            )
            .join(", ")}]`
        : "";
    lines.push(`  - ${step.id}: ${summary}${mappings}`);
  }

  return lines;
}

function buildSummary(input: {
  planId: string;
  plan: GenerationPlan;
  endpoints: FullEndpoint[];
  capabilities: CapabilityDefinition[];
  recommendedOperationIds: string[];
}): string {
  const endpointsById = new Map(
    input.endpoints.map((endpoint) => [endpoint.operationId, endpoint]),
  );

  return [
    `Plan "${input.plan.serverName}" (${input.capabilities.length} capabilities, ${input.plan.resolvedOperationIds.length} endpoints)`,
    `Output mode: ${input.plan.outputMode}`,
    `Auth required: ${input.plan.authStrategy.requiresAuth ? "yes" : "no"}`,
    "",
    "Capabilities:",
    ...input.capabilities.flatMap((capability, index) => [
      `${index + 1}. ${describeCapability(capability, endpointsById)[0]}`,
      ...describeCapability(capability, endpointsById).slice(1),
    ]),
    "",
    `Resolved operationIds: ${input.plan.resolvedOperationIds.join(", ")}`,
    `Recommended follow-ups: ${input.recommendedOperationIds.join(", ") || "(none)"}`,
    `Plan ID: ${input.planId}`,
  ].join("\n");
}

export async function resolveGoal(input: {
  goal: string;
  outputMode?: OutputMode;
  serverName?: string;
}): Promise<ResolvedGoal> {
  const suggestions = await suggestEndpoints({
    goal: input.goal,
    limit: 5,
  });
  if (suggestions.length === 0) {
    throw new Error(`No endpoint suggestions matched "${input.goal}".`);
  }
  const searchResults = await searchEndpoints({
    query: input.goal,
    limit: 20,
  });
  const initialOperationIds = selectOperationIds({
    goal: input.goal,
    suggestions,
    searchResults,
  });
  if (initialOperationIds.length === 0) {
    throw new Error(`No operationIds could be resolved for "${input.goal}".`);
  }

  const allEndpoints = await loadAllEndpoints();
  const graph = buildDependencyGraph(allEndpoints);
  const dependencyResolution = resolveEndpointDependencies(initialOperationIds, graph);
  const resolvedOperationIds = [
    ...new Set([...initialOperationIds, ...dependencyResolution.required]),
  ];
  const endpoints = resolvedOperationIds
    .map((operationId) => graph.endpointsById.get(operationId))
    .filter((endpoint): endpoint is FullEndpoint => Boolean(endpoint));
  const capabilities = groupCapabilities({
    endpointIds: resolvedOperationIds,
    preferredOperationIds: initialOperationIds,
    graph,
  });
  const planId = input.serverName
    ? `${input.serverName}-${randomUUID().slice(0, 8)}`
    : `resolved-goal-${randomUUID().slice(0, 8)}`;
  const plan = buildGenerationPlan({
    serverName: input.serverName ?? planId,
    outputMode: input.outputMode,
    endpoints,
    selectedOperationIds: initialOperationIds,
    capabilities,
  });
  const summary = buildSummary({
    planId,
    plan,
    endpoints,
    capabilities,
    recommendedOperationIds: dependencyResolution.recommended,
  });

  return {
    planId,
    plan,
    endpoints,
    capabilities,
    summary,
    recommendedOperationIds: dependencyResolution.recommended,
  };
}
