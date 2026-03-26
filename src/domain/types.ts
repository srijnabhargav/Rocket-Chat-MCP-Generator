export type Domain =
  | "authentication"
  | "messaging"
  | "rooms"
  | "user-management"
  | "omnichannel"
  | "integrations"
  | "settings"
  | "statistics"
  | "notifications"
  | "content-management"
  | "marketplace-apps"
  | "miscellaneous";

export const VALID_DOMAINS: Domain[] = [
  "authentication",
  "messaging",
  "rooms",
  "user-management",
  "omnichannel",
  "integrations",
  "settings",
  "statistics",
  "notifications",
  "content-management",
  "marketplace-apps",
  "miscellaneous",
];

export type OutputMode = "mcp-server" | "mcp-server-extension";

export interface CompactEndpoint {
  operationId: string;
  method: string;
  path: string;
  summary: string;
  domain: Domain;
  tag: string;
}

export interface SearchResult extends CompactEndpoint {
  score: number;
}

export type SuggestionConfidence = "high" | "medium" | "low";

export interface SuggestionResult {
  title: string;
  reason: string;
  operationIds: string[];
  domains: Domain[];
  confidence: SuggestionConfidence;
  matchedTerms: string[];
  workflowNames?: string[];
}

export interface EndpointParameter {
  name: string;
  in: "query" | "path" | "header" | "cookie";
  required: boolean;
  description?: string;
  schema?: Record<string, unknown>;
}

export interface EndpointRequestBody {
  contentType: string;
  required: boolean;
  schema: Record<string, unknown>;
}

export interface FullEndpoint {
  operationId: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  domain: Domain;
  tag: string;
  parameters: EndpointParameter[];
  requestBody?: EndpointRequestBody;
  security: Array<Record<string, string[]>>;
  inputSchema: Record<string, unknown>;
}

export interface AuthStrategy {
  mode: "none" | "env-login";
  autoIncludeLoginTool: boolean;
  requiresAuth: boolean;
}

export interface WorkflowInputMapping {
  targetPath: string;
  sourceStepId: string;
  sourcePath: string;
}

export interface WorkflowStepDefinition {
  id: string;
  operationId: string;
  inputMappings: WorkflowInputMapping[];
}

export interface WorkflowDefinition {
  name: string;
  description: string;
  domains: Domain[];
  steps: WorkflowStepDefinition[];
  operationIds: string[];
}

export interface PlanWarning {
  code:
    | "missing_operation_ids"
    | "unknown_workflows"
    | "duplicate_selection"
    | "auto_added_login";
  message: string;
  severity: "warning" | "info";
  details?: string[];
}

export interface GenerationPlan {
  serverName: string;
  outputMode: OutputMode;
  selectedOperationIds: string[];
  selectedWorkflows: string[];
  resolvedWorkflowOperationIds: string[];
  resolvedOperationIds: string[];
  warnings: PlanWarning[];
  authStrategy: AuthStrategy;
}

export interface GeneratedProjectManifest {
  serverName: string;
  projectDir: string;
  filePaths: string[];
  toolCount: number;
}

export interface ValidationReport {
  projectDir: string;
  missingFiles: string[];
  toolFiles: string[];
  testFiles: string[];
  isValid: boolean;
}
