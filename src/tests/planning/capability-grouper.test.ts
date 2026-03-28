import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FullEndpoint, SchemaConnection } from "../../domain/index.js";
import { groupCapabilities } from "../../planning/capability-grouper.js";
import type { DependencyGraph } from "../../planning/dependency-graph.js";

function makeEndpoint(
  id: string,
  domain: string,
  method = "GET",
  responseFields: Record<string, string> = {},
  inputFields: Record<string, string> = {},
): FullEndpoint {
  const responseProperties = Object.fromEntries(
    Object.entries(responseFields).map(([key, type]) => [key, { type }]),
  );
  const inputProperties = Object.fromEntries(
    Object.entries(inputFields).map(([key, type]) => [key, { type }]),
  );

  return {
    operationId: id,
    method,
    path: `/api/v1/${id}`,
    summary: id.replace(/-/g, " "),
    description: `Test endpoint ${id}`,
    domain: domain as FullEndpoint["domain"],
    tag: domain,
    parameters: [],
    requestBody: Object.keys(inputFields).length > 0
      ? {
          contentType: "application/json",
          required: true,
          schema: { type: "object", properties: inputProperties },
        }
      : undefined,
    responseSchema: Object.keys(responseFields).length > 0
      ? {
          statusCode: "200",
          contentType: "application/json",
          schema: { type: "object", properties: responseProperties },
        }
      : undefined,
    security: [],
    inputSchema: {
      type: "object",
      properties: Object.keys(inputFields).length > 0
        ? { requestBody: { type: "object", properties: inputProperties } }
        : {},
    },
  };
}

function makeConnection(
  fromId: string,
  fromField: string,
  toId: string,
  toField: string,
  confidence: SchemaConnection["confidence"] = "exact",
): SchemaConnection {
  return {
    from: {
      operationId: fromId,
      fieldName: fromField,
      fieldPath: fromField,
      type: "string",
      direction: "output",
    },
    to: {
      operationId: toId,
      fieldName: toField,
      fieldPath: toField,
      type: "string",
      direction: "input",
    },
    fieldName: fromField,
    confidence,
  };
}

function buildTestGraph(
  endpoints: FullEndpoint[],
  connections: SchemaConnection[],
): DependencyGraph {
  const endpointsById = new Map(endpoints.map((ep) => [ep.operationId, ep]));
  const incomingByOperationId = new Map<string, SchemaConnection[]>();
  const outgoingByOperationId = new Map<string, SchemaConnection[]>();

  for (const conn of connections) {
    const incoming = incomingByOperationId.get(conn.to.operationId) ?? [];
    incoming.push(conn);
    incomingByOperationId.set(conn.to.operationId, incoming);

    const outgoing = outgoingByOperationId.get(conn.from.operationId) ?? [];
    outgoing.push(conn);
    outgoingByOperationId.set(conn.from.operationId, outgoing);
  }

  return { connections, endpointsById, incomingByOperationId, outgoingByOperationId };
}

describe("capability grouper", () => {
  it("passes through a small component unchanged", () => {
    const ep1 = makeEndpoint("list-rooms", "rooms", "GET", { roomId: "string" });
    const ep2 = makeEndpoint("create-room", "rooms", "POST", {}, { roomId: "string" });
    const ep3 = makeEndpoint("get-room-info", "rooms", "GET", { roomId: "string" });
    const connections = [
      makeConnection("list-rooms", "roomId", "create-room", "roomId"),
      makeConnection("get-room-info", "roomId", "create-room", "roomId"),
    ];
    const graph = buildTestGraph([ep1, ep2, ep3], connections);

    const caps = groupCapabilities({
      endpointIds: ["list-rooms", "create-room", "get-room-info"],
      preferredOperationIds: ["create-room"],
      graph,
    });

    assert.equal(caps.length, 1);
    assert.ok(caps[0]!.endpoints.length <= 5);
    assert.equal(caps[0]!.isComposed, true);
  });

  it("splits an oversized component into multiple capabilities", () => {
    const endpoints: FullEndpoint[] = [];
    const connections: SchemaConnection[] = [];

    for (let i = 0; i < 8; i++) {
      endpoints.push(
        makeEndpoint(`ep-${i}`, "rooms", "GET", { sharedId: "string" }, { sharedId: "string" }),
      );
    }
    for (let i = 0; i < 7; i++) {
      connections.push(makeConnection(`ep-${i}`, "sharedId", `ep-${i + 1}`, "sharedId"));
    }

    const graph = buildTestGraph(endpoints, connections);
    const caps = groupCapabilities({
      endpointIds: endpoints.map((ep) => ep.operationId),
      preferredOperationIds: ["ep-0"],
      graph,
    });

    assert.ok(caps.length >= 2, `Expected >= 2 capabilities, got ${caps.length}`);
    for (const cap of caps) {
      assert.ok(
        cap.endpoints.length <= 5,
        `Capability "${cap.name}" has ${cap.endpoints.length} endpoints (max 5)`,
      );
    }

    const allEndpoints = caps.flatMap((cap) => cap.endpoints);
    for (const ep of endpoints) {
      assert.ok(
        allEndpoints.includes(ep.operationId),
        `Endpoint ${ep.operationId} missing from capabilities`,
      );
    }
  });

  it("splits along domain boundaries when possible", () => {
    const roomEndpoints = [
      makeEndpoint("list-rooms", "rooms", "GET", { roomId: "string" }),
      makeEndpoint("create-room", "rooms", "POST", {}, { roomId: "string" }),
      makeEndpoint("get-room", "rooms", "GET", { roomId: "string" }),
    ];
    const userEndpoints = [
      makeEndpoint("list-users", "user-management", "GET", { userId: "string" }),
      makeEndpoint("create-user", "user-management", "POST", {}, { userId: "string" }),
      makeEndpoint("get-user", "user-management", "GET", { userId: "string" }),
    ];
    const allEndpoints = [...roomEndpoints, ...userEndpoints];

    const connections = [
      makeConnection("list-rooms", "roomId", "create-room", "roomId"),
      makeConnection("get-room", "roomId", "create-room", "roomId"),
      makeConnection("list-users", "userId", "create-user", "userId"),
      makeConnection("get-user", "userId", "create-user", "userId"),
      makeConnection("list-rooms", "roomId", "create-user", "roomId", "possible"),
    ];

    const graph = buildTestGraph(allEndpoints, connections);
    const caps = groupCapabilities({
      endpointIds: allEndpoints.map((ep) => ep.operationId),
      preferredOperationIds: ["create-room", "create-user"],
      graph,
    });

    assert.ok(caps.length >= 2, `Expected >= 2 capabilities, got ${caps.length}`);
    for (const cap of caps) {
      assert.ok(cap.endpoints.length <= 5);
    }
  });

  it("keeps a single endpoint as a non-composed capability", () => {
    const ep = makeEndpoint("get-stats", "statistics", "GET", { total: "number" });
    const graph = buildTestGraph([ep], []);

    const caps = groupCapabilities({
      endpointIds: ["get-stats"],
      preferredOperationIds: ["get-stats"],
      graph,
    });

    assert.equal(caps.length, 1);
    assert.equal(caps[0]!.isComposed, false);
    assert.equal(caps[0]!.endpoints.length, 1);
  });

  it("preserves the preferred endpoint as primary after splitting", () => {
    const endpoints: FullEndpoint[] = [];
    const connections: SchemaConnection[] = [];

    for (let i = 0; i < 8; i++) {
      endpoints.push(
        makeEndpoint(`node-${i}`, "rooms", i === 4 ? "POST" : "GET", { link: "string" }, { link: "string" }),
      );
    }
    for (let i = 0; i < 7; i++) {
      connections.push(makeConnection(`node-${i}`, "link", `node-${i + 1}`, "link"));
    }

    const graph = buildTestGraph(endpoints, connections);
    const caps = groupCapabilities({
      endpointIds: endpoints.map((ep) => ep.operationId),
      preferredOperationIds: ["node-4"],
      graph,
    });

    const capWithPreferred = caps.find((cap) => cap.endpoints.includes("node-4"));
    assert.ok(capWithPreferred, "Preferred endpoint should appear in some capability");
    assert.equal(capWithPreferred.primaryEndpoint, "node-4");
  });

  it("falls back to chunking when the component is fully connected", () => {
    const endpoints: FullEndpoint[] = [];
    const connections: SchemaConnection[] = [];

    for (let i = 0; i < 7; i++) {
      endpoints.push(
        makeEndpoint(`dense-${i}`, "rooms", "GET", { shared: "string" }, { shared: "string" }),
      );
    }
    for (let i = 0; i < 7; i++) {
      for (let j = i + 1; j < 7; j++) {
        connections.push(makeConnection(`dense-${i}`, "shared", `dense-${j}`, "shared"));
      }
    }

    const graph = buildTestGraph(endpoints, connections);
    const caps = groupCapabilities({
      endpointIds: endpoints.map((ep) => ep.operationId),
      preferredOperationIds: ["dense-0"],
      graph,
    });

    assert.ok(caps.length >= 2, `Expected >= 2 capabilities, got ${caps.length}`);
    for (const cap of caps) {
      assert.ok(cap.endpoints.length <= 5);
    }

    const allEndpoints = caps.flatMap((cap) => cap.endpoints);
    assert.equal(allEndpoints.length, 7);
  });

  it("handles disconnected endpoints as separate capabilities", () => {
    const ep1 = makeEndpoint("alpha", "rooms", "GET");
    const ep2 = makeEndpoint("beta", "messaging", "POST");
    const graph = buildTestGraph([ep1, ep2], []);

    const caps = groupCapabilities({
      endpointIds: ["alpha", "beta"],
      preferredOperationIds: ["alpha"],
      graph,
    });

    assert.equal(caps.length, 2);
    assert.equal(caps[0]!.isComposed, false);
    assert.equal(caps[1]!.isComposed, false);
  });

  it("prefers cutting cross-domain edges over same-domain edges", () => {
    const ep1 = makeEndpoint("room-list", "rooms", "GET", { roomId: "string" });
    const ep2 = makeEndpoint("room-create", "rooms", "POST", {}, { roomId: "string" });
    const ep3 = makeEndpoint("room-info", "rooms", "GET", { roomId: "string" });
    const ep4 = makeEndpoint("msg-send", "messaging", "POST", {}, { roomId: "string" });
    const ep5 = makeEndpoint("msg-get", "messaging", "GET", { roomId: "string" });
    const ep6 = makeEndpoint("user-info", "user-management", "GET", { userId: "string" });
    const ep7 = makeEndpoint("user-create", "user-management", "POST", {}, { userId: "string" });

    const connections = [
      makeConnection("room-list", "roomId", "room-create", "roomId"),
      makeConnection("room-info", "roomId", "room-create", "roomId"),
      makeConnection("room-list", "roomId", "msg-send", "roomId", "likely"),
      makeConnection("msg-get", "roomId", "msg-send", "roomId"),
      makeConnection("user-info", "userId", "user-create", "userId"),
      makeConnection("room-list", "roomId", "user-create", "roomId", "possible"),
    ];

    const graph = buildTestGraph([ep1, ep2, ep3, ep4, ep5, ep6, ep7], connections);
    const caps = groupCapabilities({
      endpointIds: [ep1, ep2, ep3, ep4, ep5, ep6, ep7].map((e) => e.operationId),
      preferredOperationIds: ["room-create", "msg-send"],
      graph,
    });

    assert.ok(caps.length >= 2, `Expected >= 2 capabilities, got ${caps.length}`);
    for (const cap of caps) {
      assert.ok(cap.endpoints.length <= 5);
    }
  });
});
