# Rocket.Chat MCP Generator

You are using the Rocket.Chat MCP Generator extension.

## Purpose

This extension generates **minimal Rocket.Chat MCP servers** instead of broad API wrappers.

The goal is to keep the generated server:
- small
- production-ready
- readable
- testable

## Workflow

Use the tools in this order:

1. Discover endpoints by domain or tag.
2. Build a generation plan from the selected operationIds.
3. Generate the MCP server project.
4. Validate the generated project.
5. Analyze minimality when useful.

## Guidelines

- Prefer the smallest endpoint set that solves the user's problem.
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
