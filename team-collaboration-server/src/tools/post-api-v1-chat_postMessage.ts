import { client } from "../rc-client.js";
import type { ToolDefinition } from "./index.js";

export const tool: ToolDefinition = {
  name: "post-api-v1-chat_postMessage",
  description: `Post Message`,
  inputSchema: {
    "type": "object",
    "properties": {
      "requestBody": {
        "oneOf": [
          {
            "type": "object",
            "required": [
              "roomId"
            ],
            "properties": {
              "alias": {
                "type": "string",
                "description": "This will cause the message's name to appear as the given alias, but your username will still be displayed."
              },
              "avatar": {
                "type": "string",
                "description": "If provided, the avatar will be displayed as the provided image URL."
              },
              "emoji": {
                "type": "string",
                "description": "If provided, the avatar will be displayed as an emoji."
              },
              "roomId": {
                "type": "string",
                "description": "The room ID or an array of room IDs where the message is to be sent. You can use channel name or username. The channel name must have the `#` prefix. `@` refers to username."
              },
              "text": {
                "type": "string",
                "description": "The message text to send, it is optional because of attachments."
              },
              "parseUrls": {
                "type": "boolean",
                "description": "Set `parseUrls` to `false` to prevent Rocket.Chat from generating link previews when the message in `text` contains a URL."
              },
              "attachments": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "audio_url": {
                      "type": "string",
                      "description": "Audio file to attach. See the <a href='https://developer.mozilla.org/en-US/docs/Web/HTML/Element/audio'>HTML audio element</a> for information."
                    },
                    "author_icon": {
                      "type": "string",
                      "description": "Displays a tiny icon to the left of the author's name."
                    },
                    "author_link": {
                      "type": "string",
                      "description": "Providing this makes the author's name clickable and points to the provided link."
                    },
                    "author_name": {
                      "type": "string",
                      "description": "Name of the author."
                    },
                    "collapsed": {
                      "type": "boolean",
                      "description": "Causes the image, audio, and video sections to be displayed as collapsed when set to true."
                    },
                    "color": {
                      "type": "string",
                      "description": "See <a href='https://developer.mozilla.org/en-US/docs/Web/CSS/background-color'>background-css</a> for the supported colors.'"
                    },
                    "fields": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "required": [
                          "title",
                          "value"
                        ],
                        "properties": {
                          "short": {
                            "type": "boolean",
                            "description": "Whether this field should be a short field."
                          },
                          "title": {
                            "type": "string",
                            "description": "The title of this field."
                          },
                          "value": {
                            "type": "string",
                            "description": "The value of this field, displayed underneath the title value."
                          }
                        }
                      }
                    },
                    "image_url": {
                      "type": "string",
                      "description": "The image to display, will be big and easy to see."
                    },
                    "message_link": {
                      "type": "string",
                      "description": "Only applicable if the `ts` field is provided, as it makes the time clickable to this link."
                    },
                    "text": {
                      "type": "string",
                      "description": "The text to display for this attachment, it is different than the message's text."
                    },
                    "thumb_url": {
                      "type": "string",
                      "description": "An image that displays to the left of the text, looks better when this is relatively small."
                    },
                    "title": {
                      "type": "string",
                      "description": "Title to display for this attachment, displays under the author."
                    },
                    "title_link": {
                      "type": "string",
                      "description": "Providing this makes the title clickable, pointing to this link."
                    },
                    "title_link_download": {
                      "type": "boolean",
                      "description": "When this is true, a download icon appears and clicking this saves the link to file."
                    },
                    "ts": {
                      "type": "string",
                      "description": "Displays the time next to the text portion."
                    },
                    "video_url": {
                      "type": "string",
                      "description": "Video file to attach. See the <a href='https://developer.mozilla.org/en-US/docs/Web/HTML/Element/video'>HTML video element</a> for information."
                    }
                  }
                }
              },
              "tmid": {
                "type": "string",
                "description": "The message ID of the original message to reply to or to create a thread on."
              },
              "customFields": {
                "type": "object",
                "description": "You can add custom fields for messages. For example, set priorities for messages.\n\nYou must enable this option and define the validation in the workspace settings. See the <a href=\"https://docs.rocket.chat/docs/message\" target=\"_blank\">Message</a> settings for further information."
              }
            }
          },
          {
            "type": "object",
            "required": [
              "channel"
            ],
            "properties": {
              "alias": {
                "type": "string",
                "description": "This will cause the message's name to appear as the given alias, but your username will still be displayed."
              },
              "avatar": {
                "type": "string",
                "description": "If provided, the avatar will be displayed as the provided image URL."
              },
              "channel": {
                "type": "string",
                "description": "The channel ID or an array of channel IDs where the message is to be sent. You can use channel name or username. The channel name must have the `#` prefix. `@` refers to username."
              },
              "emoji": {
                "type": "string",
                "description": "If provided, the avatar will be displayed as an emoji."
              },
              "text": {
                "type": "string",
                "description": "The message text to send, it is optional because of attachments."
              },
              "parseUrls": {
                "type": "boolean",
                "description": "Set `parseUrls` to `false` to prevent Rocket.Chat from generating link previews when the message in `text` contains a URL."
              },
              "attachments": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "audio_url": {
                      "type": "string",
                      "description": "Audio file to attach. See the <a href='https://developer.mozilla.org/en-US/docs/Web/HTML/Element/audio'>HTML audio element</a> for information."
                    },
                    "author_icon": {
                      "type": "string",
                      "description": "Displays a tiny icon to the left of the author's name."
                    },
                    "author_link": {
                      "type": "string",
                      "description": "Providing this makes the author's name clickable and points to the provided link."
                    },
                    "author_name": {
                      "type": "string",
                      "description": "Name of the author."
                    },
                    "collapsed": {
                      "type": "boolean",
                      "description": "Causes the image, audio, and video sections to be displayed as collapsed when set to true."
                    },
                    "color": {
                      "type": "string",
                      "description": "See <a href='https://developer.mozilla.org/en-US/docs/Web/CSS/background-color'>background-css</a> for the supported colors.'"
                    },
                    "fields": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "required": [
                          "title",
                          "value"
                        ],
                        "properties": {
                          "short": {
                            "type": "boolean",
                            "description": "Whether this field should be a short field."
                          },
                          "title": {
                            "type": "string",
                            "description": "The title of this field."
                          },
                          "value": {
                            "type": "string",
                            "description": "The value of this field, displayed underneath the title value."
                          }
                        }
                      }
                    },
                    "image_url": {
                      "type": "string",
                      "description": "The image to display, will be big and easy to see."
                    },
                    "message_link": {
                      "type": "string",
                      "description": "Only applicable if the `ts` field is provided, as it makes the time clickable to this link."
                    },
                    "text": {
                      "type": "string",
                      "description": "The text to display for this attachment, it is different than the message's text."
                    },
                    "thumb_url": {
                      "type": "string",
                      "description": "An image that displays to the left of the text, looks better when this is relatively small."
                    },
                    "title": {
                      "type": "string",
                      "description": "Title to display for this attachment, displays under the author."
                    },
                    "title_link": {
                      "type": "string",
                      "description": "Providing this makes the title clickable, pointing to this link."
                    },
                    "title_link_download": {
                      "type": "boolean",
                      "description": "When this is true, a download icon appears and clicking this saves the link to file."
                    },
                    "ts": {
                      "type": "string",
                      "description": "Displays the time next to the text portion."
                    },
                    "video_url": {
                      "type": "string",
                      "description": "Video file to attach. See the <a href='https://developer.mozilla.org/en-US/docs/Web/HTML/Element/video'>HTML video element</a> for information."
                    }
                  }
                }
              },
              "customFields": {
                "type": "object",
                "description": "You can add custom fields for messages. For example, set priorities for messages.\n\nYou must enable this option and define the validation in the workspace settings. See the <a href=\"https://docs.rocket.chat/docs/message\" target=\"_blank\">Message</a> settings for further information."
              }
            }
          }
        ]
      }
    }
  },
  handler: async (args) => {
    const resolvedPath = "/api/v1/chat.postMessage";
    const fullPath = resolvedPath;
    return client.request("POST", fullPath, { auth: true, body: args["requestBody"] });
  },
};
