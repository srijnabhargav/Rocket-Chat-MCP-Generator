import type { FullEndpoint } from "../domain/index.js";
import { getSpecStats } from "../specs/index.js";

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) {
    return `${(bytes / 1_000_000).toFixed(1)} MB`;
  }
  if (bytes >= 1_000) {
    return `${(bytes / 1_000).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

export async function analyzeMinimality(
  endpoints: FullEndpoint[],
): Promise<string> {
  const stats = await getSpecStats();
  const selectedSchemaBytes = endpoints.reduce(
    (sum, endpoint) => sum + JSON.stringify(endpoint.inputSchema).length,
    0,
  );

  const endpointReduction =
    stats.totalEndpoints > 0
      ? (((stats.totalEndpoints - endpoints.length) / stats.totalEndpoints) * 100).toFixed(1)
      : "0.0";
  const schemaReduction =
    stats.totalSchemaBytes > 0
      ? (
          ((stats.totalSchemaBytes - selectedSchemaBytes) / stats.totalSchemaBytes) *
          100
        ).toFixed(1)
      : "0.0";

  return [
    "Minimality Report:",
    `  Endpoints: ${stats.totalEndpoints} total -> ${endpoints.length} selected (${endpointReduction}% reduction)`,
    `  Schema:    ${formatBytes(stats.totalSchemaBytes)} total -> ${formatBytes(selectedSchemaBytes)} selected (${schemaReduction}% reduction)`,
  ].join("\n");
}
