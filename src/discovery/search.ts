import type { Domain, SearchResult, SuggestionResult } from "../domain/index.js";
import { SuggestEngine } from "./suggest-engine.js";

const engine = new SuggestEngine();

export async function searchEndpoints(input: {
  query: string;
  domains?: Domain[];
  limit?: number;
}): Promise<SearchResult[]> {
  return engine.search(input);
}

export async function suggestEndpoints(input: {
  goal: string;
  domains?: Domain[];
  limit?: number;
}): Promise<SuggestionResult[]> {
  return engine.suggest(input);
}
