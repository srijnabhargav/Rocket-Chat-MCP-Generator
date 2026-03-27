import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSchemaConnections,
  extractEndpointFields,
} from "../../specs/index.js";
import {
  channelsListEndpoint,
  postMessageEndpoint,
} from "../fixtures/endpoints.js";

describe("schema overlap analysis", () => {
  it("extracts both input and output fields from endpoints", () => {
    const fields = extractEndpointFields(postMessageEndpoint);

    assert.ok(
      fields.some(
        (field) =>
          field.direction === "input" && field.fieldPath === "requestBody.roomId",
      ),
    );
    assert.ok(
      fields.some(
        (field) =>
          field.direction === "output" && field.fieldPath === "message.roomId",
      ),
    );
  });

  it("connects compatible response and request fields across endpoints", () => {
    const connections = buildSchemaConnections([
      channelsListEndpoint,
      postMessageEndpoint,
    ]);

    assert.ok(
      connections.some(
        (connection) =>
          connection.from.operationId === channelsListEndpoint.operationId &&
          connection.to.operationId === postMessageEndpoint.operationId &&
          connection.to.fieldPath === "requestBody.roomId",
      ),
    );
  });
});
