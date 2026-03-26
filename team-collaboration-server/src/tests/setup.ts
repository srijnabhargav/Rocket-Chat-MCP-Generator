import { mock } from "node:test";
import { tools, type ToolDefinition } from "../tools/index.js";

export const ctx: {
  tools: ToolDefinition[];
  lastFetchUrl: string;
  lastFetchOptions: RequestInit;
  fetchHistory: Array<{ url: string; options: RequestInit }>;
  queuedResponses: Array<{ body: unknown; status: number }>;
  mockFetch: ReturnType<typeof mock.fn>;
} = {
  tools,
  lastFetchUrl: "",
  lastFetchOptions: {},
  fetchHistory: [],
  queuedResponses: [],
  mockFetch: mock.fn(async (url: string | URL | Request, init?: RequestInit) => {
    ctx.lastFetchUrl = String(url);
    ctx.lastFetchOptions = init || {};
    ctx.fetchHistory.push({ url: String(url), options: init || {} });
    const nextResponse = ctx.queuedResponses.shift() ?? {
      body: { success: true },
      status: 200,
    };
    return new Response(JSON.stringify(nextResponse.body), {
      status: nextResponse.status,
      headers: { "Content-Type": "application/json" },
    });
  }),
};

let initialized = false;

export async function init(): Promise<void> {
  if (initialized) return;
  initialized = true;
  process.env.ROCKETCHAT_URL = "http://localhost:3000";
  process.env.ROCKETCHAT_AUTH_TOKEN = "test-token";
  process.env.ROCKETCHAT_USER_ID = "test-user-id";
  (globalThis as { fetch: typeof fetch }).fetch =
    ctx.mockFetch as unknown as typeof fetch;
}

export function queueResponse(body: unknown, status = 200): void {
  ctx.queuedResponses.push({ body, status });
}

export function reset(): void {
  ctx.lastFetchUrl = "";
  ctx.lastFetchOptions = {};
  ctx.fetchHistory = [];
  ctx.queuedResponses = [];
  ctx.mockFetch.mock.resetCalls();
}
