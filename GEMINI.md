# Rocket.Chat MCP Generator

You are using the Rocket.Chat MCP Generator extension.

## Purpose

This extension **generates** minimal Rocket.Chat MCP servers. It is a code-generation tool, NOT a Rocket.Chat client.

## IMPORTANT: When to use these tools

Only use the generator tools (`resolve_goal`, `generate_from_plan`, etc.) when the user explicitly asks to **generate**, **create**, or **build** a new MCP server.

If the user asks to **send a message**, **list channels**, **create a user**, or perform any other Rocket.Chat action, do NOT call the generator. Instead, use the tools from an already-generated Rocket.Chat MCP server (if one is connected) or tell the user they need to generate one first.

## Workflow

When the user asks to generate a new server, use the tools in this order:

1. Call `resolve_goal` with the user's natural-language description.
2. Show the returned plan summary to the user and confirm it.
3. If the user wants changes, call `adjust_plan` with the same `planId` to add/remove endpoints or append a sub-goal. Repeat until confirmed.
4. Call `generate_from_plan` with the `planId` and output directory.
5. Call `register_gemini_server` to register the generated server in Gemini CLI's settings so it can be used immediately.
6. Validate the generated project when useful.

Advanced flow for fine-grained control:

1. Discover endpoints by domain or tag.
2. Build a generation plan from the selected operationIds.
3. Generate the MCP server project.
4. Validate the generated project.
5. Analyze minimality when useful.

## Guidelines

- Prefer the smallest endpoint set that solves the user's problem.
- Prefer `resolve_goal` over manual endpoint browsing unless the user explicitly wants fine control.
- Do not generate unrelated Rocket.Chat API surface.
- Treat generation as engine-first: plan before generating.
- Treat automation as optional. Do not assume install, build, or registration should happen automatically.

## Rocket.Chat Domains

Valid domains:
- `authentication`
- `messaging`
- `rooms`
- `user-management`
- `omnichannel`
- `integrations`
- `settings`
- `statistics`
- `notifications`
- `content-management`
- `marketplace-apps`
- `miscellaneous`
