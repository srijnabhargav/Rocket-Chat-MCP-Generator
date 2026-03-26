import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { ctx, init, reset } from "./setup.js";

before(() => init());
beforeEach(() => reset());

describe("post-api-v1-channels_create", () => {
  it("exposes a valid object schema", () => {
    const tool = ctx.tools.find((candidate) => candidate.name === "post-api-v1-channels_create");
    assert.ok(tool);
    assert.equal(tool.inputSchema.type, "object");
  });

  it("sends the expected request", async () => {
    const tool = ctx.tools.find((candidate) => candidate.name === "post-api-v1-channels_create");
    assert.ok(tool);
    await tool.handler({"requestBody":{"test":"value"}});
    assert.equal((ctx.lastFetchOptions as RequestInit).method, "POST");
  });
});
