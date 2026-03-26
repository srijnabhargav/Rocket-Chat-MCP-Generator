import { client } from "../rc-client.js";
import type { ToolDefinition } from "./index.js";

export const tool: ToolDefinition = {
  name: "post-api-v1-login",
  description: `Login with Username and Password`,
  inputSchema: {
    "type": "object",
    "properties": {
      "requestBody": {
        "type": "object",
        "properties": {
          "user": {
            "type": "string",
            "description": "Your user name or email."
          },
          "password": {
            "type": "string",
            "description": "Your pasword."
          },
          "resume": {
            "type": "string",
            "description": "Your previously issued `authToken`."
          },
          "code": {
            "type": "string",
            "description": "The 2FA code. It is required if your account has two-factor authentication enabled ."
          }
        }
      }
    }
  },
  handler: async (args) => {
    const resolvedPath = "/api/v1/login";
    const fullPath = resolvedPath;
    const result = await client.request("POST", fullPath, { body: args["requestBody"] });
    if (!result.isError) {
      try {
        const data = JSON.parse(result.content[0].text);
        if (data.data?.authToken && data.data?.userId) {
          client.setAuth(data.data.authToken, data.data.userId);
        }
      } catch {
        // Leave auth unchanged if the response could not be parsed.
      }
    }
    return result;
  },
};
