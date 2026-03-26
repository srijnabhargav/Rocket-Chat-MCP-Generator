import type { FullEndpoint } from "./types.js";

const AUTH_HEADER_NAMES = new Set(["X-Auth-Token", "X-User-Id"]);

export function endpointRequiresAuth(endpoint: FullEndpoint): boolean {
  return (
    endpoint.security.length > 0 ||
    endpoint.parameters.some(
      (parameter) =>
        parameter.in === "header" && AUTH_HEADER_NAMES.has(parameter.name),
    )
  );
}
