import type { FullEndpoint } from "../../domain/index.js";

export const loginEndpoint: FullEndpoint = {
  operationId: "post-api-v1-login",
  method: "POST",
  path: "/api/v1/login",
  summary: "Login",
  description: "Login with username and password.",
  domain: "authentication",
  tag: "Login",
  parameters: [],
  requestBody: {
    contentType: "application/json",
    required: true,
    schema: {
      type: "object",
      properties: {
        user: { type: "string" },
        password: { type: "string" },
      },
      required: ["user", "password"],
    },
  },
  responseSchema: {
    statusCode: "200",
    contentType: "application/json",
    schema: {
      type: "object",
      properties: {
        data: {
          type: "object",
          properties: {
            authToken: { type: "string" },
            userId: { type: "string" },
          },
        },
      },
    },
  },
  security: [],
  inputSchema: {
    type: "object",
    properties: {
      requestBody: {
        type: "object",
      },
    },
    required: ["requestBody"],
  },
};

export const statisticsEndpoint: FullEndpoint = {
  operationId: "get-api-v1-statistics",
  method: "GET",
  path: "/api/v1/statistics",
  summary: "Get statistics",
  description: "Get workspace statistics.",
  domain: "statistics",
  tag: "Statistics",
  parameters: [],
  responseSchema: {
    statusCode: "200",
    contentType: "application/json",
    schema: {
      type: "object",
      properties: {
        totalUsers: { type: "number" },
        onlineUsers: { type: "number" },
      },
    },
  },
  security: [],
  inputSchema: {
    type: "object",
    properties: {},
  },
};

export const channelsListEndpoint: FullEndpoint = {
  operationId: "get-api-v1-channels_list",
  method: "GET",
  path: "/api/v1/channels.list",
  summary: "List channels",
  description: "List workspace channels.",
  domain: "rooms",
  tag: "Channels",
  parameters: [
    {
      name: "X-Auth-Token",
      in: "header",
      required: true,
      schema: { type: "string" },
    },
    {
      name: "X-User-Id",
      in: "header",
      required: true,
      schema: { type: "string" },
    },
    {
      name: "count",
      in: "query",
      required: false,
      schema: { type: "number" },
    },
  ],
  responseSchema: {
    statusCode: "200",
    contentType: "application/json",
    schema: {
      type: "object",
      properties: {
        channels: {
          type: "array",
          items: {
            type: "object",
            properties: {
              _id: { type: "string" },
              name: { type: "string" },
            },
          },
        },
      },
    },
  },
  security: [{ userAuth: [] }],
  inputSchema: {
    type: "object",
    properties: {
      count: { type: "number" },
    },
  },
};

export const usersListEndpoint: FullEndpoint = {
  operationId: "get-api-v1-users_list",
  method: "GET",
  path: "/api/v1/users.list",
  summary: "List users",
  description: "List workspace users.",
  domain: "user-management",
  tag: "Users",
  parameters: [
    {
      name: "count",
      in: "query",
      required: false,
      schema: { type: "number" },
    },
    {
      name: "offset",
      in: "query",
      required: false,
      schema: { type: "number" },
    },
  ],
  responseSchema: {
    statusCode: "200",
    contentType: "application/json",
    schema: {
      type: "object",
      properties: {
        users: {
          type: "array",
          items: {
            type: "object",
            properties: {
              _id: { type: "string" },
              name: { type: "string" },
              username: { type: "string" },
              status: { type: "string" },
            },
          },
        },
        count: { type: "number" },
        offset: { type: "number" },
        total: { type: "number" },
      },
    },
  },
  security: [{ userAuth: [] }],
  inputSchema: {
    type: "object",
    properties: {
      count: { type: "number" },
      offset: { type: "number" },
    },
  },
};

export const postMessageEndpoint: FullEndpoint = {
  operationId: "post-api-v1-chat_postMessage",
  method: "POST",
  path: "/api/v1/chat.postMessage",
  summary: "Post message",
  description: "Post a message into a room.",
  domain: "messaging",
  tag: "Chat",
  parameters: [
    {
      name: "X-Auth-Token",
      in: "header",
      required: true,
      schema: { type: "string" },
    },
    {
      name: "X-User-Id",
      in: "header",
      required: true,
      schema: { type: "string" },
    },
  ],
  requestBody: {
    contentType: "application/json",
    required: true,
    schema: {
      type: "object",
      properties: {
        roomId: { type: "string" },
        text: { type: "string" },
      },
      required: ["roomId", "text"],
    },
  },
  responseSchema: {
    statusCode: "200",
    contentType: "application/json",
    schema: {
      type: "object",
      properties: {
        message: {
          type: "object",
          properties: {
            _id: { type: "string" },
            roomId: { type: "string" },
          },
        },
      },
    },
  },
  security: [{ userAuth: [] }],
  inputSchema: {
    type: "object",
    properties: {
      requestBody: {
        type: "object",
        properties: {
          roomId: { type: "string" },
          text: { type: "string" },
        },
        required: ["roomId", "text"],
      },
    },
    required: ["requestBody"],
  },
};
