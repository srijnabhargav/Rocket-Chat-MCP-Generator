import { randomUUID } from "node:crypto";
import {
  type CapabilityDefinition,
  type FullEndpoint,
  type GenerationPlan,
  type OutputMode,
  type PlanConfidence,
  type SchemaConnection,
  type SearchResult,
  type SuggestionResult,
} from "../domain/index.js";
import {
  type DependencyGraph,
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
  confidence: PlanConfidence;
  summary: string;
  recommendedOperationIds: string[];
}

let cachedAllEndpointsPromise: Promise<FullEndpoint[]> | null = null;

async function loadAllEndpoints(): Promise<FullEndpoint[]> {
  cachedAllEndpointsPromise ??= getAllFullEndpoints();
  return cachedAllEndpointsPromise;
}

function chooseSuggestions(
  suggestions: SuggestionResult[],
  goalTermCount = Infinity,
): SuggestionResult[] {
  const maxSuggestions = goalTermCount <= 2 ? 1 : 2;
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
    if (chosen.length >= maxSuggestions) {
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

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "to", "for", "from", "with", "in", "of",
  "is", "it", "my", "on", "at", "by", "do", "be", "so", "if", "up",
]);

const ENTITY_ID_KEYS = new Set([
  "room_id", "user_id", "message_id", "team_id",
  "department_id", "agent_id", "visitor_id",
  "integration_id", "file_id", "role_id",
]);

const INPUT_FIELD_TO_ENTITY: Array<[RegExp, string]> = [
  [/\b(roomId|rid|channelId|channel_id)\b/, "room_id"],
  [/\b(userId|uid|ownerId|owner_id)\b/, "user_id"],
  [/\b(messageId|msgId|msg_id)\b/, "message_id"],
  [/\b(teamId)\b/, "team_id"],
  [/\b(departmentId)\b/, "department_id"],
  [/\b(agentId)\b/, "agent_id"],
  [/\b(visitorId)\b/, "visitor_id"],
];

const ENTITY_LOOKUP_PATTERNS: Record<string, RegExp[]> = {
  room_id: [/channels[._-]info/i, /rooms[._-]info/i, /channels[._-]list/i, /rooms[._-]get/i],
  user_id: [/users[._-]info/i, /users[._-]list/i],
  message_id: [/chat[._-]getMessage/i, /chat[._-]search/i],
  team_id: [/teams[._-]info/i, /teams[._-]listAll/i],
  department_id: [/livechat[._-]department/i],
  agent_id: [/livechat[._-]agent/i],
  visitor_id: [/livechat[._-]visitor/i],
};

const MAX_INJECTED_LOOKUPS = 3;

function detectEntityKeysFromSchema(schema: Record<string, unknown>): Set<string> {
  const keys = new Set<string>();
  const schemaStr = JSON.stringify(schema);
  for (const [pattern, entityKey] of INPUT_FIELD_TO_ENTITY) {
    if (pattern.test(schemaStr)) {
      keys.add(entityKey);
    }
  }
  return keys;
}

export function injectPrerequisiteLookups(input: {
  selectedIds: string[];
  graph: DependencyGraph;
}): string[] {
  const { selectedIds, graph } = input;
  const selectedSet = new Set(selectedIds);
  const injected: string[] = [];

  const neededEntityKeys = new Set<string>();
  for (const opId of selectedIds) {
    const endpoint = graph.endpointsById.get(opId);
    if (!endpoint || endpoint.method === "GET") {
      continue;
    }

    const incoming = graph.incomingByOperationId.get(opId) ?? [];
    for (const connection of incoming) {
      if (
        ENTITY_ID_KEYS.has(connection.fieldName) &&
        connection.to.direction === "input"
      ) {
        neededEntityKeys.add(connection.fieldName);
      }
    }

    for (const key of detectEntityKeysFromSchema(endpoint.inputSchema)) {
      neededEntityKeys.add(key);
    }
  }

  const providedEntityKeys = new Set<string>();
  for (const opId of selectedIds) {
    const endpoint = graph.endpointsById.get(opId);
    if (!endpoint || endpoint.method !== "GET") {
      continue;
    }
    const outgoing = graph.outgoingByOperationId.get(opId) ?? [];
    for (const connection of outgoing) {
      if (ENTITY_ID_KEYS.has(connection.fieldName)) {
        providedEntityKeys.add(connection.fieldName);
      }
    }
  }

  for (const entityKey of neededEntityKeys) {
    if (providedEntityKeys.has(entityKey) || injected.length >= MAX_INJECTED_LOOKUPS) {
      continue;
    }

    const bestFromGraph = findBestLookupFromGraph(entityKey, selectedSet, graph);
    if (bestFromGraph) {
      injected.push(bestFromGraph);
      selectedSet.add(bestFromGraph);
      continue;
    }

    const bestFromPattern = findBestLookupByPattern(entityKey, selectedSet, graph);
    if (bestFromPattern) {
      injected.push(bestFromPattern);
      selectedSet.add(bestFromPattern);
    }
  }

  return [...selectedIds, ...injected];
}

function findBestLookupFromGraph(
  entityKey: string,
  alreadySelected: Set<string>,
  graph: DependencyGraph,
): string | null {
  const candidates: Array<{ operationId: string; score: number }> = [];

  for (const connection of graph.connections) {
    if (
      connection.fieldName !== entityKey ||
      connection.from.direction !== "output" ||
      alreadySelected.has(connection.from.operationId)
    ) {
      continue;
    }

    const sourceEndpoint = graph.endpointsById.get(connection.from.operationId);
    if (!sourceEndpoint || sourceEndpoint.method !== "GET") {
      continue;
    }

    const confidenceScore = { exact: 3, likely: 2, possible: 1 }[connection.confidence];
    const isInfo = /info\b/i.test(sourceEndpoint.operationId) ? 2 : 0;
    candidates.push({
      operationId: connection.from.operationId,
      score: confidenceScore + isInfo,
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  const deduped = new Map<string, number>();
  for (const c of candidates) {
    const existing = deduped.get(c.operationId) ?? 0;
    if (c.score > existing) {
      deduped.set(c.operationId, c.score);
    }
  }

  return [...deduped.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function findBestLookupByPattern(
  entityKey: string,
  alreadySelected: Set<string>,
  graph: DependencyGraph,
): string | null {
  const patterns = ENTITY_LOOKUP_PATTERNS[entityKey];
  if (!patterns) {
    return null;
  }

  for (const pattern of patterns) {
    for (const [opId, endpoint] of graph.endpointsById) {
      if (
        endpoint.method === "GET" &&
        !alreadySelected.has(opId) &&
        pattern.test(opId)
      ) {
        return opId;
      }
    }
  }

  return null;
}

const MAX_SELECTED_OPERATION_IDS = 6;
const MAX_CRUD_CLUSTER_SIZE = 6;

const MANAGE_VERBS = new Set([
  "manage", "administer", "maintain", "handle", "control", "configure",
]);

const CRUD_ROLE_PATTERNS: Array<{ role: string; patterns: RegExp[] }> = [
  { role: "create", patterns: [/\bcreate\b/i] },
  { role: "list", patterns: [/\blist\b/i, /_list\b/i] },
  { role: "info", patterns: [/\binfo\b/i, /\bget\s+\w+\s+info/i] },
  { role: "update", patterns: [/\bupdate\b/i, /\bedit\b/i, /\brename\b/i] },
  { role: "delete", patterns: [/\bdelete\b/i, /\bremove\b/i] },
];

interface ManageIntent {
  verb: string;
  resourceTerms: string[];
}

function detectManageIntent(goalTerms: string[]): ManageIntent | null {
  const verb = goalTerms.find((term) => MANAGE_VERBS.has(term));
  if (!verb) {
    return null;
  }
  const resourceTerms = goalTerms.filter((term) => !MANAGE_VERBS.has(term));
  if (resourceTerms.length === 0) {
    return null;
  }
  return { verb, resourceTerms };
}

interface CrudClusterResult {
  operationIds: string[];
  tagName: string;
}

function buildCrudCluster(
  searchResults: SearchResult[],
  resourceTerms: string[],
): CrudClusterResult | null {
  const tagScores = new Map<string, { total: number; results: SearchResult[] }>();

  for (const result of searchResults) {
    const searchable = [result.operationId, result.summary, result.path, result.tag]
      .join(" ")
      .toLowerCase();
    const matchesResource = resourceTerms.some((term) => searchable.includes(term));
    if (!matchesResource) {
      continue;
    }

    const entry = tagScores.get(result.tag) ?? { total: 0, results: [] };
    entry.total += result.score;
    entry.results.push(result);
    tagScores.set(result.tag, entry);
  }

  if (tagScores.size === 0) {
    return null;
  }

  const bestTag = [...tagScores.entries()].sort(
    (left, right) => right[1].total - left[1].total,
  )[0];
  const tagResults = bestTag[1].results;

  const selectedOps: string[] = [];
  const filledRoles = new Set<string>();

  for (const { role, patterns } of CRUD_ROLE_PATTERNS) {
    if (filledRoles.has(role)) {
      continue;
    }
    const candidate = tagResults.find((result) => {
      const text = `${result.operationId} ${result.summary}`;
      return patterns.some((pattern) => pattern.test(text));
    });
    if (candidate && !selectedOps.includes(candidate.operationId)) {
      selectedOps.push(candidate.operationId);
      filledRoles.add(role);
    }
    if (selectedOps.length >= MAX_CRUD_CLUSTER_SIZE) {
      break;
    }
  }

  if (selectedOps.length === 0) {
    return null;
  }

  return { operationIds: selectedOps, tagName: bestTag[0] };
}

function extractGoalTerms(goal: string): string[] {
  return goal
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));
}

function computeCoveredTerms(
  goalTerms: string[],
  searchResults: SearchResult[],
  operationIds: string[],
): Set<string> {
  const covered = new Set<string>();
  const opSet = new Set(operationIds);
  const matchedResults = searchResults.filter((result) =>
    opSet.has(result.operationId),
  );
  const searchable = matchedResults
    .map((result) =>
      [result.operationId, result.summary, result.path, result.tag, result.domain].join(" "),
    )
    .join(" ")
    .toLowerCase();

  for (const term of goalTerms) {
    if (searchable.includes(term)) {
      covered.add(term);
    }
  }
  return covered;
}

interface SelectionResult {
  operationIds: string[];
  goalTerms: string[];
  coveredTerms: Set<string>;
  hasWorkflowMatch: boolean;
  hasCrudCluster: boolean;
}

function selectOperationIds(input: {
  goal: string;
  suggestions: SuggestionResult[];
  searchResults: SearchResult[];
}): SelectionResult {
  const goalTerms = extractGoalTerms(input.goal);
  const coveredTerms = new Set<string>();
  const selectedOps = new Set<string>();
  let hasCrudCluster = false;

  const manageIntent = detectManageIntent(goalTerms);
  if (manageIntent) {
    const crudCluster = buildCrudCluster(input.searchResults, manageIntent.resourceTerms);
    if (crudCluster) {
      hasCrudCluster = true;
      for (const op of crudCluster.operationIds) {
        selectedOps.add(op);
      }
      coveredTerms.add(manageIntent.verb);
      const tagLower = crudCluster.tagName.toLowerCase();
      for (const term of manageIntent.resourceTerms) {
        if (tagLower.includes(term)) {
          coveredTerms.add(term);
        }
      }
    }
  }

  const selectedSuggestions = chooseSuggestions(input.suggestions, goalTerms.length);

  const workflowSuggestions = selectedSuggestions.filter(
    (suggestion) => (suggestion.workflowNames?.length ?? 0) > 0,
  );
  const hasWorkflowMatch = workflowSuggestions.length > 0;
  for (const suggestion of workflowSuggestions) {
    for (const operationId of suggestion.operationIds) {
      selectedOps.add(operationId);
    }
  }

  for (const term of computeCoveredTerms(goalTerms, input.searchResults, [...selectedOps])) {
    coveredTerms.add(term);
  }

  if (coveredTerms.size >= goalTerms.length && selectedOps.size > 0) {
    return {
      operationIds: [...selectedOps].slice(0, MAX_SELECTED_OPERATION_IDS),
      goalTerms,
      coveredTerms,
      hasWorkflowMatch,
      hasCrudCluster,
    };
  }

  const hintedDomains = new Set(
    selectedSuggestions.flatMap((suggestion) => suggestion.domains),
  );

  const uncoveredTerms = goalTerms.filter((term) => !coveredTerms.has(term));
  const uncoveredGoal = uncoveredTerms.length > 0 ? uncoveredTerms.join(" ") : input.goal;

  const rankedResults = input.searchResults
    .map((result) => ({
      result,
      score: rankSearchResult({
        goal: uncoveredGoal,
        result,
        hintedDomains,
      }),
    }))
    .sort((left, right) => right.score - left.score);

  for (const ranked of rankedResults) {
    if (selectedOps.size >= MAX_SELECTED_OPERATION_IDS) {
      break;
    }
    if (selectedOps.has(ranked.result.operationId)) {
      continue;
    }

    const resultSearchable = [
      ranked.result.operationId,
      ranked.result.summary,
      ranked.result.path,
      ranked.result.tag,
      ranked.result.domain,
    ]
      .join(" ")
      .toLowerCase();

    const newlyCovered = uncoveredTerms.filter(
      (term) => !coveredTerms.has(term) && resultSearchable.includes(term),
    );

    if (newlyCovered.length === 0 && selectedOps.size > 0) {
      continue;
    }

    selectedOps.add(ranked.result.operationId);
    for (const term of newlyCovered) {
      coveredTerms.add(term);
    }

    if (coveredTerms.size >= goalTerms.length) {
      break;
    }
  }

  return {
    operationIds: [...selectedOps].slice(0, MAX_SELECTED_OPERATION_IDS),
    goalTerms,
    coveredTerms,
    hasWorkflowMatch,
    hasCrudCluster,
  };
}

function computePlanConfidence(selection: SelectionResult): PlanConfidence {
  const { goalTerms, coveredTerms, hasWorkflowMatch, hasCrudCluster } = selection;

  const termCoverage =
    goalTerms.length > 0 ? coveredTerms.size / goalTerms.length : 0;

  const signals: string[] = [];
  if (hasWorkflowMatch) {
    signals.push("workflow_match");
  }
  if (hasCrudCluster) {
    signals.push("crud_cluster");
  }
  if (termCoverage >= 1) {
    signals.push("full_term_coverage");
  } else if (termCoverage >= 0.5) {
    signals.push("partial_term_coverage");
  }

  let level: PlanConfidence["level"];
  if (termCoverage >= 1 && (hasWorkflowMatch || hasCrudCluster)) {
    level = "high";
  } else if (termCoverage >= 0.5 || hasWorkflowMatch || hasCrudCluster) {
    level = "medium";
  } else {
    level = "low";
  }

  return {
    level,
    termCoverage: Math.round(termCoverage * 100) / 100,
    signals,
  };
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
  confidence: PlanConfidence;
  recommendedOperationIds: string[];
}): string {
  const endpointsById = new Map(
    input.endpoints.map((endpoint) => [endpoint.operationId, endpoint]),
  );

  const confidencePct = Math.round(input.confidence.termCoverage * 100);
  const confidenceLine =
    `Confidence: ${input.confidence.level} (${confidencePct}% term coverage` +
    (input.confidence.signals.length > 0
      ? `, signals: ${input.confidence.signals.join(", ")}`
      : "") +
    ")";

  return [
    `Plan "${input.plan.serverName}" (${input.capabilities.length} capabilities, ${input.plan.resolvedOperationIds.length} endpoints)`,
    `Output mode: ${input.plan.outputMode}`,
    `Auth required: ${input.plan.authStrategy.requiresAuth ? "yes" : "no"}`,
    confidenceLine,
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

async function buildResolvedGoalFromIds(input: {
  planId: string;
  initialOperationIds: string[];
  confidence: PlanConfidence;
  serverName?: string;
  outputMode?: OutputMode;
}): Promise<ResolvedGoal> {
  const allEndpoints = await loadAllEndpoints();
  const graph = buildDependencyGraph(allEndpoints);
  const dependencyResolution = resolveEndpointDependencies(
    input.initialOperationIds,
    graph,
  );
  const resolvedOperationIds = [
    ...new Set([...input.initialOperationIds, ...dependencyResolution.required]),
  ];
  const endpoints = resolvedOperationIds
    .map((operationId) => graph.endpointsById.get(operationId))
    .filter((endpoint): endpoint is FullEndpoint => Boolean(endpoint));
  const capabilities = groupCapabilities({
    endpointIds: resolvedOperationIds,
    preferredOperationIds: input.initialOperationIds,
    graph,
  });
  const plan = buildGenerationPlan({
    serverName: input.serverName ?? input.planId,
    outputMode: input.outputMode,
    endpoints,
    selectedOperationIds: input.initialOperationIds,
    capabilities,
  });
  const summary = buildSummary({
    planId: input.planId,
    plan,
    endpoints,
    capabilities,
    confidence: input.confidence,
    recommendedOperationIds: dependencyResolution.recommended,
  });

  return {
    planId: input.planId,
    plan,
    endpoints,
    capabilities,
    confidence: input.confidence,
    summary,
    recommendedOperationIds: dependencyResolution.recommended,
  };
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
  const selection = selectOperationIds({
    goal: input.goal,
    suggestions,
    searchResults,
  });
  if (selection.operationIds.length === 0) {
    throw new Error(`No operationIds could be resolved for "${input.goal}".`);
  }

  const preferredMethod = inferPreferredMethod(input.goal);
  let enrichedIds = selection.operationIds;
  if (preferredMethod === "WRITE") {
    const allEndpoints = await loadAllEndpoints();
    const graph = buildDependencyGraph(allEndpoints);
    enrichedIds = injectPrerequisiteLookups({
      selectedIds: selection.operationIds,
      graph,
    });
  }

  const confidence = computePlanConfidence(selection);
  const planId = input.serverName
    ? `${input.serverName}-${randomUUID().slice(0, 8)}`
    : `resolved-goal-${randomUUID().slice(0, 8)}`;

  return buildResolvedGoalFromIds({
    planId,
    initialOperationIds: enrichedIds,
    confidence,
    serverName: input.serverName,
    outputMode: input.outputMode,
  });
}

export async function adjustResolvedGoal(input: {
  previousGoal: ResolvedGoal;
  addOperationIds?: string[];
  removeOperationIds?: string[];
  addGoal?: string;
}): Promise<ResolvedGoal> {
  const hasAdd = (input.addOperationIds?.length ?? 0) > 0;
  const hasRemove = (input.removeOperationIds?.length ?? 0) > 0;
  const hasGoal = Boolean(input.addGoal?.trim());
  if (!hasAdd && !hasRemove && !hasGoal) {
    throw new Error(
      "At least one adjustment is required: addOperationIds, removeOperationIds, or addGoal.",
    );
  }

  const previousSelectedIds = new Set(
    input.previousGoal.plan.selectedOperationIds,
  );

  if (input.addOperationIds) {
    const allEndpoints = await loadAllEndpoints();
    const knownIds = new Set(allEndpoints.map((ep) => ep.operationId));
    const unknownIds = input.addOperationIds.filter((id) => !knownIds.has(id));
    if (unknownIds.length > 0) {
      throw new Error(
        `Unknown operationIds: ${unknownIds.join(", ")}. Use search_endpoints to find valid IDs.`,
      );
    }
    for (const id of input.addOperationIds) {
      previousSelectedIds.add(id);
    }
  }

  if (hasGoal) {
    const subGoal = input.addGoal!.trim();
    const suggestions = await suggestEndpoints({ goal: subGoal, limit: 5 });
    const searchResults = await searchEndpoints({ query: subGoal, limit: 20 });
    if (suggestions.length > 0) {
      const selection = selectOperationIds({
        goal: subGoal,
        suggestions,
        searchResults,
      });
      for (const id of selection.operationIds) {
        previousSelectedIds.add(id);
      }
    }
  }

  if (input.removeOperationIds) {
    for (const id of input.removeOperationIds) {
      previousSelectedIds.delete(id);
    }
  }

  const mergedIds = [...previousSelectedIds];
  if (mergedIds.length === 0) {
    throw new Error("Adjustment resulted in an empty operation set.");
  }

  const allEndpoints = await loadAllEndpoints();
  const graph = buildDependencyGraph(allEndpoints);
  const hasWriteEndpoint = mergedIds.some((id) => {
    const ep = graph.endpointsById.get(id);
    return ep && ep.method !== "GET";
  });
  const enrichedIds = hasWriteEndpoint
    ? injectPrerequisiteLookups({ selectedIds: mergedIds, graph })
    : mergedIds;

  const allTerms = extractGoalTerms(
    enrichedIds.join(" "),
  );
  const confidence = computePlanConfidence({
    operationIds: enrichedIds,
    goalTerms: allTerms,
    coveredTerms: new Set(allTerms),
    hasWorkflowMatch: input.previousGoal.confidence.signals.includes("workflow_match"),
    hasCrudCluster: input.previousGoal.confidence.signals.includes("crud_cluster"),
  });

  return buildResolvedGoalFromIds({
    planId: input.previousGoal.planId,
    initialOperationIds: enrichedIds,
    confidence,
    serverName: input.previousGoal.plan.serverName,
    outputMode: input.previousGoal.plan.outputMode,
  });
}
