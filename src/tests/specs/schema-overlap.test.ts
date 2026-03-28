import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSchemaConnections,
  extractEndpointFields,
  isNoisyField,
} from "../../specs/index.js";
import type { FullEndpoint } from "../../domain/index.js";
import {
  channelsListEndpoint,
  postMessageEndpoint,
  usersListEndpoint,
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

  it("preserves room_id connections after noise filtering (regression guard)", () => {
    const connections = buildSchemaConnections([
      channelsListEndpoint,
      postMessageEndpoint,
      usersListEndpoint,
    ]);

    const roomIdConnections = connections.filter(
      (connection) => connection.fieldName === "room_id",
    );
    assert.ok(
      roomIdConnections.length > 0,
      "room_id connections must survive filtering",
    );
  });

  it("filters out denylisted pagination and metadata fields", () => {
    const connections = buildSchemaConnections([
      channelsListEndpoint,
      postMessageEndpoint,
      usersListEndpoint,
    ]);

    const noisyConnections = connections.filter(
      (connection) =>
        connection.fieldName === "count" ||
        connection.fieldName === "offset" ||
        connection.fieldName === "name" ||
        connection.fieldName === "status",
    );
    assert.equal(
      noisyConnections.length,
      0,
      "denylisted fields must produce zero connections",
    );
  });

  it("preserves entity identifier connections through the allowlist", () => {
    const connections = buildSchemaConnections([
      channelsListEndpoint,
      postMessageEndpoint,
      usersListEndpoint,
    ]);

    const entityFields = new Set(
      connections.map((connection) => connection.fieldName),
    );
    assert.ok(
      entityFields.has("room_id"),
      "room_id must be preserved by allowlist",
    );
  });
});

describe("isNoisyField", () => {
  it("returns true for denylisted fields regardless of fanout", () => {
    assert.equal(isNoisyField("count", 1, 1, 100), true);
    assert.equal(isNoisyField("offset", 1, 1, 100), true);
    assert.equal(isNoisyField("name", 1, 1, 100), true);
    assert.equal(isNoisyField("updatedat", 1, 1, 100), true);
  });

  it("returns false for allowlisted entity fields regardless of fanout", () => {
    assert.equal(isNoisyField("room_id", 200, 200, 100), false);
    assert.equal(isNoisyField("user_id", 200, 200, 100), false);
    assert.equal(isNoisyField("message_id", 200, 200, 100), false);
    assert.equal(isNoisyField("teamid", 200, 200, 100), false);
  });

  it("filters unknown fields that exceed the fanout threshold", () => {
    assert.equal(isNoisyField("somefield", 25, 25, 100), true);
    assert.equal(isNoisyField("somefield", 10, 10, 100), false);
  });

  it("keeps unknown fields below the fanout threshold", () => {
    assert.equal(isNoisyField("departmentid", 50, 50, 100), false);
    assert.equal(isNoisyField("rareentity", 5, 3, 100), false);
  });
});
