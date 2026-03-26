import type { ToolResult } from "../rc-client.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

import { tool as tool0 } from "./post-api-v1-channels_create.js";
import { tool as tool1 } from "./post-api-v1-channels_invite.js";
import { tool as tool2 } from "./post-api-v1-chat_postMessage.js";
import { tool as tool3 } from "./post-api-v1-login.js";

export const tools: ToolDefinition[] = [
  tool0,
  tool1,
  tool2,
  tool3,
];
