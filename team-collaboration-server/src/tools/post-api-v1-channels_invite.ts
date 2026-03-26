import { client } from "../rc-client.js";
import type { ToolDefinition } from "./index.js";

export const tool: ToolDefinition = {
  name: "post-api-v1-channels_invite",
  description: `Add Users to Channel`,
  inputSchema: {
    "type": "object",
    "properties": {
      "requestBody": {
        "type": "object",
        "oneOf": [
          {
            "type": "object",
            "required": [
              "roomId",
              "userId"
            ],
            "properties": {
              "roomId": {
                "type": "string",
                "description": "The channel's ID."
              },
              "userId": {
                "type": "string",
                "description": "The user id to be invited."
              }
            }
          },
          {
            "type": "object",
            "required": [
              "roomId",
              "userIds"
            ],
            "properties": {
              "roomId": {
                "type": "string",
                "description": "The channel's id"
              },
              "userIds": {
                "type": "array",
                "description": "An array of the userId of users to be invited",
                "items": {
                  "type": "object",
                  "properties": {
                    "type": {
                      "type": "string"
                    },
                    "value": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          }
        ]
      }
    }
  },
  handler: async (args) => {
    const resolvedPath = "/api/v1/channels.invite";
    const fullPath = resolvedPath;
    return client.request("POST", fullPath, { auth: true, body: args["requestBody"] });
  },
};
