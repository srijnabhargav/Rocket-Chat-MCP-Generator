import { client } from "../rc-client.js";
import type { ToolDefinition } from "./index.js";

export const tool: ToolDefinition = {
  name: "post-api-v1-channels_create",
  description: `Create Channel`,
  inputSchema: {
    "type": "object",
    "properties": {
      "requestBody": {
        "type": "object",
        "required": [
          "name"
        ],
        "properties": {
          "name": {
            "type": "string",
            "description": "The name of the channel."
          },
          "members": {
            "type": "array",
            "description": "An array of the users to be added to the channel when it is created.",
            "items": {
              "type": "string"
            }
          },
          "readOnly": {
            "type": "boolean",
            "description": "Set if the channel is read only or not. It is `false` by default."
          },
          "excludeSelf": {
            "type": "boolean",
            "description": "If set to true, the user calling the endpoint is not automatically added as a member of the channel. The default `value` is false."
          },
          "customFields": {
            "type": "object",
            "description": "If you have defined custom fields for your workspace, you can provide them in this object parameter. For details, see the <a href='https://docs.rocket.chat/docs/custom-fields' target='_blank'>Custom Fields</a> document."
          },
          "extraData": {
            "type": "object",
            "description": "Enter the following details for the object:\n- `broadcast`: Whether the channel should be a broadcast room.\n- `encrypted`: Whether the channel should be encrypted.\n- `teamId`: Enter an existing team ID for this channel. You need the `create-team-channel` permission to add a team to a channel.\n\nFor more information, see <a href='https://docs.rocket.chat/use-rocket.chat/user-guides/rooms/channels#channel-privacy-and-encryption' target='_blank'>Channels</a>"
          }
        }
      }
    }
  },
  handler: async (args) => {
    const resolvedPath = "/api/v1/channels.create";
    const fullPath = resolvedPath;
    return client.request("POST", fullPath, { auth: true, body: args["requestBody"] });
  },
};
