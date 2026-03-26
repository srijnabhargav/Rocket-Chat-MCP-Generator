import {
  VALID_DOMAINS,
  type CompactEndpoint,
  type Domain,
  type SearchResult,
  type SuggestionConfidence,
  type SuggestionResult,
} from "../domain/index.js";
import { discoverEndpoints } from "../specs/index.js";
import { listWorkflows } from "./workflow-catalog.js";
import { expandWithSynonyms, inferDomains, tokenize } from "./synonym-map.js";

interface ScoredEndpoint {
  endpoint: CompactEndpoint;
  score: number;
  matchedTerms: Set<string>;
}

interface SuggestionCandidate {
  title: string;
  reason: string;
  operationIds: string[];
  domains: Domain[];
  confidence: SuggestionConfidence;
  matchedTerms: string[];
  workflowNames?: string[];
  score: number;
}

const LOGIN_OPERATION_ID = "post-api-v1-login";

let cachedEndpointsPromise: Promise<CompactEndpoint[]> | null = null;

async function loadEndpoints(): Promise<CompactEndpoint[]> {
  cachedEndpointsPromise ??= discoverEndpoints(VALID_DOMAINS);
  return cachedEndpointsPromise;
}

function filterByDomains(
  endpoints: CompactEndpoint[],
  domains?: Domain[],
): CompactEndpoint[] {
  if (!domains || domains.length === 0) {
    return endpoints;
  }

  const domainSet = new Set(domains);
  return endpoints.filter((endpoint) => domainSet.has(endpoint.domain));
}

function buildFieldWeights(endpoint: CompactEndpoint): Map<string, number> {
  const weightedFields: Array<{ text: string; weight: number }> = [
    { text: endpoint.operationId, weight: 10 },
    { text: endpoint.path, weight: 5 },
    { text: endpoint.tag, weight: 3 },
    { text: endpoint.summary, weight: 2 },
    { text: endpoint.domain, weight: 2 },
  ];

  const weights = new Map<string, number>();
  for (const field of weightedFields) {
    for (const token of tokenize(field.text)) {
      const current = weights.get(token) ?? 0;
      if (field.weight > current) {
        weights.set(token, field.weight);
      }
    }
  }

  return weights;
}

function buildDocumentFrequency(
  endpoints: CompactEndpoint[],
  expandedTokens: string[],
): Map<string, number> {
  const frequency = new Map<string, number>();

  for (const endpoint of endpoints) {
    const endpointTokens = new Set(buildFieldWeights(endpoint).keys());
    for (const token of expandedTokens) {
      if (endpointTokens.has(token)) {
        frequency.set(token, (frequency.get(token) ?? 0) + 1);
      }
    }
  }

  return frequency;
}

function scoreEndpoints(
  endpoints: CompactEndpoint[],
  query: string,
): ScoredEndpoint[] {
  const originalTokens = tokenize(query);
  if (originalTokens.length === 0) {
    return [];
  }

  const originalTokenSet = new Set(originalTokens);
  const expandedTokens = expandWithSynonyms(originalTokens);
  const docFrequency = buildDocumentFrequency(endpoints, expandedTokens);
  const totalDocs = Math.max(endpoints.length, 1);

  return endpoints
    .map((endpoint) => {
      const fieldWeights = buildFieldWeights(endpoint);
      let score = 0;
      const matchedTerms = new Set<string>();

      for (const token of expandedTokens) {
        const fieldWeight = fieldWeights.get(token);
        if (fieldWeight === undefined) {
          continue;
        }

        const df = docFrequency.get(token) ?? 1;
        const idf = Math.log(1 + totalDocs / df);
        const directWeight = originalTokenSet.has(token) ? 3 : 1;
        score += idf * directWeight * fieldWeight;

        for (const originalToken of originalTokens) {
          if (
            token === originalToken ||
            (expandWithSynonyms([originalToken]).includes(token) && fieldWeight >= 2)
          ) {
            matchedTerms.add(originalToken);
          }
        }
      }

      return { endpoint, score, matchedTerms };
    })
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score);
}

function buildSearchResults(
  scoredEndpoints: ScoredEndpoint[],
  limit: number,
): SearchResult[] {
  return scoredEndpoints.slice(0, limit).map((result) => ({
    ...result.endpoint,
    score: Number(result.score.toFixed(3)),
  }));
}

function buildClusterCandidates(
  scoredEndpoints: ScoredEndpoint[],
  queryTokens: string[],
): SuggestionCandidate[] {
  const grouped = new Map<
    string,
    {
      domain: Domain;
      tag: string;
      items: ScoredEndpoint[];
      totalScore: number;
      matchedTerms: Set<string>;
    }
  >();

  for (const item of scoredEndpoints) {
    if (item.endpoint.operationId === LOGIN_OPERATION_ID) {
      continue;
    }
    const key = `${item.endpoint.domain}::${item.endpoint.tag}`;
    const current = grouped.get(key) ?? {
      domain: item.endpoint.domain,
      tag: item.endpoint.tag,
      items: [],
      totalScore: 0,
      matchedTerms: new Set<string>(),
    };

    const isNoise =
      current.items.length > 0 && item.score < current.items[0].score * 0.45;

    if (!isNoise && current.items.length < 4) {
      current.items.push(item);
      current.totalScore += item.score;
      for (const term of item.matchedTerms) {
        current.matchedTerms.add(term);
      }
    }

    grouped.set(key, current);
  }

  return [...grouped.values()]
    .filter((group) => group.items.length > 0)
    .sort((left, right) => right.totalScore - left.totalScore)
    .map((group) => ({
      title: `${group.tag} (${group.domain})`,
      reason: `Matched terms [${[...group.matchedTerms].join(", ")}] against ${group.tag} endpoints in ${group.domain}.`,
      operationIds: group.items.map((item) => item.endpoint.operationId),
      domains: [group.domain],
      confidence: toConfidence(group.matchedTerms.size, queryTokens.length),
      matchedTerms: [...group.matchedTerms],
      score: group.totalScore,
    }));
}

function buildWorkflowCandidates(
  scoredEndpoints: ScoredEndpoint[],
  queryTokens: string[],
  allowedDomains?: Domain[],
): SuggestionCandidate[] {
  const scoredByOperationId = new Map(
    scoredEndpoints.map((item) => [item.endpoint.operationId, item]),
  );

  return listWorkflows()
    .filter((workflow) =>
      !allowedDomains || allowedDomains.length === 0
        ? true
        : workflow.domains.some((domain) => allowedDomains.includes(domain)),
    )
    .map((workflow) => {
      const workflowTokens = new Set(
        expandWithSynonyms(
          tokenize(
            `${workflow.name} ${workflow.description} ${workflow.domains.join(" ")} ${workflow.operationIds.join(" ")}`,
          ),
        ),
      );
      const matchedTerms = new Set<string>();
      let score = 0;

      for (const queryToken of queryTokens) {
        const expanded = expandWithSynonyms([queryToken]);
        if (expanded.some((token) => workflowTokens.has(token))) {
          matchedTerms.add(queryToken);
          score += 10;
        }
      }

      for (const operationId of workflow.operationIds) {
        const endpoint = scoredByOperationId.get(operationId);
        if (endpoint) {
          score += endpoint.score;
          for (const term of endpoint.matchedTerms) {
            matchedTerms.add(term);
          }
        }
      }

      const inferredDomains = inferDomains(queryTokens);
      const inferredDomainHits = workflow.domains.filter((domain) =>
        inferredDomains.includes(domain),
      ).length;
      if (matchedTerms.size > 0) {
        score += workflow.domains.length * 6;
        score += inferredDomainHits * 12;
      }

      return {
        title: workflow.name,
        reason: `Predefined workflow covering ${workflow.domains.join(", ")} for matched terms [${[...matchedTerms].join(", ")}].`,
        operationIds: workflow.operationIds,
        domains: workflow.domains,
        confidence: toConfidence(matchedTerms.size, queryTokens.length),
        matchedTerms: [...matchedTerms],
        workflowNames: [workflow.name],
        score,
      };
    })
    .filter((candidate) => candidate.score > 0);
}

function buildGoalBundleCandidate(
  clusterCandidates: SuggestionCandidate[],
  queryTokens: string[],
): SuggestionCandidate | null {
  const inferredDomains = new Set(inferDomains(queryTokens));
  const remaining = [...clusterCandidates];
  const selected: SuggestionCandidate[] = [];
  const coveredTerms = new Set<string>();
  const selectedDomains = new Set<Domain>();

  while (remaining.length > 0 && selected.length < 3) {
    let bestIndex = -1;
    let bestScore = -1;

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const newCoverage = candidate.matchedTerms.filter(
        (term) => !coveredTerms.has(term),
      ).length;
      const inferredBoost = candidate.domains.some((domain) =>
        inferredDomains.has(domain),
      )
        ? 1.2
        : 1;
      const diversityPenalty = candidate.domains.every((domain) =>
        selectedDomains.has(domain),
      )
        ? 0.6
        : 1;
      const adjustedScore =
        (candidate.score + newCoverage * 10) * inferredBoost * diversityPenalty;

      if (adjustedScore > bestScore) {
        bestScore = adjustedScore;
        bestIndex = index;
      }
    }

    if (bestIndex === -1 || bestScore <= 0) {
      break;
    }

    const chosen = remaining.splice(bestIndex, 1)[0];
    selected.push(chosen);
    chosen.matchedTerms.forEach((term) => coveredTerms.add(term));
    chosen.domains.forEach((domain) => selectedDomains.add(domain));

    if (coveredTerms.size >= queryTokens.length) {
      break;
    }
  }

  if (selected.length < 2) {
    return null;
  }

  const operationIds = [...new Set(selected.flatMap((candidate) => candidate.operationIds))];
  const domains = [...new Set(selected.flatMap((candidate) => candidate.domains))];
  const matchedTerms = [...coveredTerms];
  const score = selected.reduce((sum, candidate) => sum + candidate.score, 0);

  return {
    title: "Goal bundle",
    reason: `Combined endpoint groups to cover matched terms [${matchedTerms.join(", ")}] across ${domains.join(", ")}.`,
    operationIds,
    domains,
    confidence: toConfidence(matchedTerms.length, queryTokens.length),
    matchedTerms,
    workflowNames: selected.flatMap((candidate) => candidate.workflowNames ?? []),
    score,
  };
}

function toConfidence(
  matchedCount: number,
  totalTokens: number,
): SuggestionConfidence {
  const coverage = totalTokens === 0 ? 0 : matchedCount / totalTokens;
  if (coverage >= 0.66) {
    return "high";
  }
  if (coverage >= 0.33) {
    return "medium";
  }
  return "low";
}

function dedupeCandidates(
  candidates: SuggestionCandidate[],
): SuggestionCandidate[] {
  const seen = new Set<string>();

  return candidates.filter((candidate) => {
    const key = candidate.operationIds.slice().sort().join(",");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export class SuggestEngine {
  async search(input: {
    query: string;
    domains?: Domain[];
    limit?: number;
  }): Promise<SearchResult[]> {
    const endpoints = filterByDomains(await loadEndpoints(), input.domains);
    const scored = scoreEndpoints(endpoints, input.query);
    return buildSearchResults(scored, input.limit ?? 20);
  }

  async suggest(input: {
    goal: string;
    domains?: Domain[];
    limit?: number;
  }): Promise<SuggestionResult[]> {
    const endpoints = filterByDomains(await loadEndpoints(), input.domains);
    const queryTokens = tokenize(input.goal);
    if (queryTokens.length === 0) {
      return [];
    }

    const scoredEndpoints = scoreEndpoints(endpoints, input.goal);
    const clusterCandidates = buildClusterCandidates(scoredEndpoints, queryTokens);
    const workflowCandidates = buildWorkflowCandidates(
      scoredEndpoints,
      queryTokens,
      input.domains,
    );
    const goalBundle = buildGoalBundleCandidate(clusterCandidates, queryTokens);

    const candidates = dedupeCandidates([
      ...(goalBundle ? [goalBundle] : []),
      ...workflowCandidates,
      ...clusterCandidates,
    ])
      .filter((candidate) => candidate.operationIds.length > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, input.limit ?? 5);

    return candidates.map(({ score: _score, ...candidate }) => candidate);
  }
}
