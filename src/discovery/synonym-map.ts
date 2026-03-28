import { type Domain } from "../domain/index.js";

export const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "to",
  "and",
  "or",
  "for",
  "in",
  "of",
  "with",
  "on",
  "at",
  "by",
  "is",
  "it",
  "be",
  "as",
  "i",
  "want",
  "need",
  "help",
  "my",
  "me",
  "we",
  "our",
  "api",
  "v1",
  "endpoint",
  "endpoints",
  "request",
  "response",
  "object",
  "body",
  "field",
  "value",
  "data",
]);

export const SYNONYM_MAP: Record<string, string[]> = {
  administer: ["manage", "create", "update", "delete", "list", "configure"],
  alert: ["message", "notify", "notification"],
  analytics: ["statistics", "metrics", "stats"],
  channel: ["channels", "room", "rooms"],
  channels: ["channel", "room", "rooms"],
  chat: ["message", "messages"],
  configure: ["manage", "settings", "update"],
  dm: ["direct", "message", "messages"],
  direct: ["dm", "message", "messages"],
  invite: ["member", "members", "user", "users", "add"],
  maintain: ["manage", "create", "update", "delete", "list"],
  manage: ["create", "update", "delete", "list", "configure"],
  member: ["members", "user", "users", "invite"],
  members: ["member", "user", "users", "invite"],
  message: ["messages", "chat", "post", "alert", "notification"],
  messages: ["message", "chat", "post", "alert", "notification"],
  metric: ["metrics", "statistics", "stats"],
  metrics: ["metric", "statistics", "stats"],
  monitor: ["statistics", "metrics", "report"],
  notify: ["alert", "message", "notification"],
  notification: ["alert", "notify", "message"],
  report: ["statistics", "metrics", "analytics"],
  room: ["rooms", "channel", "channels"],
  rooms: ["room", "channel", "channels"],
  send: ["message", "messages", "post", "notify"],
  statistic: ["statistics", "stats", "metrics", "analytics"],
  stats: ["statistics", "metrics", "analytics"],
  statistics: ["stats", "metrics", "analytics"],
  team: ["member", "members", "user", "users"],
  user: ["users", "member", "members"],
  users: ["user", "member", "members"],
};

export const DOMAIN_HINTS: Record<string, Domain[]> = {
  alert: ["messaging", "notifications"],
  analytics: ["statistics"],
  channel: ["rooms", "messaging"],
  dm: ["messaging"],
  invite: ["rooms", "user-management"],
  member: ["user-management", "rooms"],
  members: ["user-management", "rooms"],
  message: ["messaging"],
  messages: ["messaging"],
  metric: ["statistics"],
  metrics: ["statistics"],
  monitor: ["statistics"],
  notification: ["notifications", "messaging"],
  report: ["statistics"],
  room: ["rooms"],
  rooms: ["rooms"],
  settings: ["settings"],
  statistic: ["statistics"],
  stats: ["statistics"],
  statistics: ["statistics"],
  team: ["user-management", "rooms"],
  user: ["user-management"],
  users: ["user-management"],
};

export function stemToken(token: string): string {
  if (token.length <= 3) {
    return token;
  }
  if (token.endsWith("ing") && token.length > 5) {
    return token.slice(0, -3);
  }
  if (token.endsWith("ies") && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith("ers") && token.length > 5) {
    return token.slice(0, -1);
  }
  if (token.endsWith("es") && token.length > 4) {
    return token.slice(0, -1);
  }
  if (token.endsWith("s") && token.length > 3) {
    return token.slice(0, -1);
  }
  return token;
}

export function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s._-]/g, " ")
    .split(/[\s._-]+/)
    .map((token) => stemToken(token.trim()))
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export function expandWithSynonyms(tokens: string[]): string[] {
  const expanded = new Set<string>(tokens);

  for (const token of tokens) {
    const synonyms = SYNONYM_MAP[token] ?? [];
    for (const synonym of synonyms) {
      expanded.add(stemToken(synonym));
    }
  }

  return [...expanded];
}

export function inferDomains(tokens: string[]): Domain[] {
  const inferred = new Set<Domain>();

  for (const token of tokens) {
    const domains = DOMAIN_HINTS[token] ?? [];
    for (const domain of domains) {
      inferred.add(domain);
    }
  }

  return [...inferred];
}
