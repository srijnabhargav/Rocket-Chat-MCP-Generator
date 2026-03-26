const config = {
  baseUrl: process.env.ROCKETCHAT_URL || "http://localhost:3000",
  authToken: process.env.ROCKETCHAT_AUTH_TOKEN || "",
  userId: process.env.ROCKETCHAT_USER_ID || "",
};

export type ToolResult = {
  content: { type: string; text: string }[];
  isError?: boolean;
};

let initialized = false;

export async function initAuth(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const user = process.env.ROCKETCHAT_USER || "";
  const password = process.env.ROCKETCHAT_PASSWORD || "";

  if (user && password) {
    const response = await fetch(`${config.baseUrl}/api/v1/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user, password }),
    });
    const data = await response.json();
    if (!response.ok || !data.data?.authToken) {
      console.error("Login failed:", JSON.stringify(data));
      process.exit(1);
    }
    config.authToken = data.data.authToken;
    config.userId = data.data.userId;
    console.error(`Authenticated as ${user}`);
    return;
  }

  if (config.authToken && config.userId) {
    console.error("Using pre-existing auth tokens.");
    return;
  }

  console.error("No Rocket.Chat credentials found. Copy .env.example to .env and configure credentials.");
  process.exit(1);
}

class RocketChatClient {
  setAuth(token: string, userId: string): void {
    config.authToken = token;
    config.userId = userId;
  }

  async request(
    method: string,
    path: string,
    options: { auth?: boolean; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<ToolResult> {
    const url = `${config.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...options.headers,
    };

    if (options.auth) {
      headers["X-Auth-Token"] = config.authToken;
      headers["X-User-Id"] = config.userId;
    }

    const fetchOptions: RequestInit = { method, headers };
    if (options.body !== undefined) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, fetchOptions);
    const data = await response.json();

    if (!response.ok) {
      return {
        content: [{ type: "text", text: `API error ${response.status}: ${JSON.stringify(data)}` }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
}

export const client = new RocketChatClient();
