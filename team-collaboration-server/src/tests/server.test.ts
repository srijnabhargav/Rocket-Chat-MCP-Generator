import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { ctx, init } from "./setup.js";

before(() => init());

describe("tool registry", () => {
  it("exposes the generated tools", () => {
    const expected = ["post-api-v1-channels_create", "post-api-v1-channels_invite", "post-api-v1-chat_postMessage", "post-api-v1-login"];
    assert.equal(ctx.tools.length, 4);
    for (const name of expected) {
      assert.ok(ctx.tools.some((tool) => tool.name === name));
    }
  });
});
