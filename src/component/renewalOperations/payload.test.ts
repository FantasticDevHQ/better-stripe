import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { getConvexSize, getDocumentSize } from "convex/values";
import { afterEach, expect, it, vi } from "vitest";
import { modules, schema } from "../../test.js";
import { renewalSnapshot } from "../../client/billing/renewalReplacementSnapshot.js";
import {
  eventDigest,
  materialize,
  objectNode,
  scalarNode,
} from "../../client/billing/renewalAttach/internal/c10/eventCodec.js";

const VALUE_LIMIT = 1048576;
const ACTOR_JSON_LIMIT = 500000;
const BASIS_PADDING = 380000;
const EVENT_PADDING = 300000;
// These are immutable storage DATA. The padded basis is NOT a qualified Owner.
const record = Object.freeze({
  schemaVersion: 1,
  requestBinding: "journal-payload-consistency-A",
  authorization: Object.freeze({
    scope: "merchant-payload",
    id: "consent-payload",
    revision: 1,
  }),
  logicalOperationId: "payload-A",
  stage: "attach",
  account: Object.freeze({
    mode: "platform",
    stripeAccount: null,
    livemode: false,
  }),
  apiVersion: "2026-09-30.endive",
  profile: "unqualified-storage-DATA-only",
  subscriptionId: "sub_payload",
  customerId: "cus_payload",
  itemId: "si_payload",
  currentPriceId: "price_old",
  targetPriceId: "price_new",
  targetProductId: "prod_new",
  period: Object.freeze({ start: 2000000000, end: 2000003600 }),
  dispatch: Object.freeze({
    scope: "platform",
    apiVersion: "2026-09-30.endive",
    method: "POST",
    path: "/v1/subscription_schedules",
    payload: Object.freeze({ from_subscription: "sub_payload" }),
    key: "retained-payload-key",
    firstDispatchedAt: 2000000000,
  }),
  options: Object.freeze({ maxNetworkRetries: 0, redirect: "error" }),
  originalBundle: Object.freeze({
    subscription: Object.freeze({
      id: "sub_payload",
      schedule: null,
      metadata: Object.freeze({ retained: "complete" }),
    }),
    targetPrice: Object.freeze({ id: "price_new", product: "prod_new" }),
  }),
  basis: Object.freeze({
    startWallMs: 2000000000000,
    startNs: "1000000000",
    workEndWallMs: 2000000004000,
    workEndNs: "5000000000",
    endWallMs: 2000000005000,
    endNs: "6000000000",
    unqualifiedStoragePadding: "x".repeat(BASIS_PADDING),
  }),
});
const eventData = Object.freeze({
  event: "dispatch",
  request: record.dispatch,
  unqualifiedStoragePadding: "y".repeat(EVENT_PADDING),
});
// Distinct predeclared storage case. RPC argument strings remain ASCII.
const parsedUnicodeRecord = Object.freeze({
  ...record,
  logicalOperationId: "unicode-A",
  authorization: Object.freeze({ ...record.authorization, id: "\ud800" }),
  basis: Object.freeze({
    ...record.basis,
    unqualifiedStoragePadding: "finite-encoding-control",
  }),
});
const create = makeFunctionReference<"mutation">(
  "renewalOperations/mutations:createAuthorizedOperation",
);
const reserve = makeFunctionReference<"mutation">(
  "renewalOperations/mutations:reserveAttempt",
);
const append = makeFunctionReference<"mutation">(
  "renewalOperations/mutations:appendStageEvent",
);
const load = makeFunctionReference<"query">(
  "renewalOperations/queries:loadAuthorizedOperation",
);
const read = makeFunctionReference<"query">(
  "renewalOperations/queries:readAttempt",
);
afterEach(() => vi.unstubAllGlobals());

function jsonMetrics(value: unknown) {
  let nodes = 0,
    depth = 0;
  function visit(item: unknown, level: number) {
    nodes++;
    depth = Math.max(depth, level);
    if (item !== null && typeof item === "object")
      for (const child of Object.values(item)) visit(child, level + 1);
  }
  visit(value, 0);
  const json = JSON.stringify(value);
  return {
    characters: json.length,
    utf8Bytes: new TextEncoder().encode(json).length,
    nodes,
    depth,
  };
}

it("P01 refuses an oversized whole append envelope before any storage changes", async () => {
  let fetchCalls = 0;
  vi.stubGlobal("fetch", () => {
    fetchCalls++;
    throw Error("UNEXPECTED_EXTERNAL_FETCH");
  });
  const recordJSON = JSON.stringify(renewalSnapshot(record));
  const eventJSON = JSON.stringify(renewalSnapshot(eventData));
  const recordMetrics = jsonMetrics(JSON.parse(recordJSON));
  const eventMetrics = jsonMetrics(JSON.parse(eventJSON));
  for (const metric of [recordMetrics, eventMetrics]) {
    expect(metric.characters).toBeLessThan(ACTOR_JSON_LIMIT);
    expect(metric.utf8Bytes).toBeLessThan(ACTOR_JSON_LIMIT);
    expect(metric.nodes).toBeLessThanOrEqual(10000);
    expect(metric.depth).toBeLessThanOrEqual(40);
  }
  const node = objectNode([
    ["event", scalarNode("dispatch")],
    [
      "request",
      objectNode([
        ["scope", scalarNode(record.dispatch.scope)],
        ["apiVersion", scalarNode(record.dispatch.apiVersion)],
        ["method", scalarNode(record.dispatch.method)],
        ["path", scalarNode(record.dispatch.path)],
        [
          "payload",
          objectNode([
            [
              "from_subscription",
              scalarNode(record.dispatch.payload.from_subscription),
            ],
          ]),
        ],
        ["key", scalarNode(record.dispatch.key)],
        ["firstDispatchedAt", scalarNode(record.dispatch.firstDispatchedAt)],
      ]),
    ],
    [
      "unqualifiedStoragePadding",
      scalarNode(eventData.unqualifiedStoragePadding),
    ],
  ]);
  // The whole DATA is in the existing hash preimage; no padding is projected away.
  expect(materialize(node)).toEqual(eventData);
  const binding = await eventDigest(
    objectNode([
      ["sequence", scalarNode(1)],
      ["data", node],
    ]),
  );
  expect(binding).toMatch(
    /^unbound-qualification-event:v2:sha256:[0-9a-f]{64}$/,
  );
  const t = convexTest(schema, modules);
  const creationArgs = {
    authorizationScope: record.authorization.scope,
    logicalOperationId: record.logicalOperationId,
    authorizationRevision: record.authorization.revision,
    recordJSON,
  };
  expect(getConvexSize(creationArgs)).toBeLessThan(VALUE_LIMIT);
  const created = await t.mutation(create, creationArgs);
  expect(created.status).toBe("created");
  const loaded = await t.query(load, { operationId: created.operationId });
  expect(loaded.recordJSON).toBe(recordJSON);
  expect(loaded.revision).toBe(0);
  expect(loaded.activeAttempt).toBeNull();
  const reserveArgs = {
    operationId: created.operationId,
    expectedRevision: 0,
    stage: "attach",
    expectedRequestBinding: record.requestBinding,
    recordJSON,
  };
  expect(getConvexSize(reserveArgs)).toBeLessThan(VALUE_LIMIT);
  const acquired = await t.mutation(reserve, reserveArgs);
  expect(acquired.disposition).toBe("acquired");
  expect(acquired.reservation.recordJSON).toBe(recordJSON);
  expect(acquired.reservation.basisJSON).toBe(
    JSON.stringify(renewalSnapshot(record.basis)),
  );
  expect(acquired.reservation.key).toBe(record.dispatch.key);
  expect(acquired.reservation.firstDispatchedAt).toBe(
    record.dispatch.firstDispatchedAt,
  );
  expect(getConvexSize(acquired)).toBeLessThan(VALUE_LIMIT);
  const initialHistory = await t.query(read, {
    operationId: created.operationId,
    attemptId: acquired.reservation.attemptId,
  });
  expect(initialHistory.events).toHaveLength(0);
  expect(initialHistory.reservation).toEqual(acquired.reservation);
  const args = {
    reservation: acquired.reservation,
    expectedSequence: 0,
    event: { sequence: 1, binding, dataJSON: eventJSON },
  };
  const wholeArgsBytes = getConvexSize(args);
  expect(wholeArgsBytes).toBeGreaterThan(VALUE_LIMIT);
  const candidateEventPayloadBytes = getDocumentSize({
    codecVersion: 1,
    json: eventJSON,
  });
  expect(candidateEventPayloadBytes).toBeLessThan(VALUE_LIMIT);
  async function physical() {
    // Separate, joined bounded reads avoid inventing a giant production query.
    const [operations, attempts, events, payloads] = await Promise.all([
      t.run((ctx) => ctx.db.query("renewalOperations").take(3)),
      t.run((ctx) => ctx.db.query("renewalOperationAttempts").take(3)),
      t.run((ctx) => ctx.db.query("renewalOperationEvents").take(4)),
      t.run((ctx) => ctx.db.query("renewalOperationPayloads").take(6)),
    ]);
    return { operations, attempts, events, payloads };
  }
  const before = await physical();
  expect(before.operations).toHaveLength(1);
  expect(before.attempts).toHaveLength(1);
  expect(before.events).toHaveLength(0);
  expect(before.payloads).toHaveLength(1);
  expect(before.attempts[0].lastSequence).toBe(0);
  expect(before.payloads[0].json).toBe(recordJSON);
  const beforeDocumentBytes = [
    ...before.operations,
    ...before.attempts,
    ...before.events,
    ...before.payloads,
  ].map((document) => getDocumentSize(document));
  for (const bytes of beforeDocumentBytes)
    expect(bytes).toBeLessThan(VALUE_LIMIT);
  const beforeBytes = JSON.stringify(before);
  expect(fetchCalls).toBe(0);
  console.info(
    "BTS317_P01_PREREQUISITES",
    JSON.stringify({
      basisPadding: BASIS_PADDING,
      eventPadding: EVENT_PADDING,
      recordMetrics,
      eventMetrics,
      wholeArgsBytes,
      valueLimit: VALUE_LIMIT,
      candidateEventPayloadBytes,
      beforeDocumentBytes,
      counts: { operations: 1, attempts: 1, events: 0, payloads: 1 },
      sequence: before.attempts[0].lastSequence,
      fetchCalls,
    }),
  );
  let settlement:
    | { status: "fulfilled" }
    | { status: "rejected"; message: string; messageLength: number }
    | undefined;
  let after: Awaited<ReturnType<typeof physical>> | undefined;
  let appendResultBytes: number | undefined;
  try {
    const actualReply = await t.mutation(append, args);
    appendResultBytes = getConvexSize(actualReply);
    settlement = { status: "fulfilled" };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "NON_ERROR_REJECTION";
    settlement = {
      status: "rejected",
      message: message.slice(0, 200),
      messageLength: message.length,
    };
  } finally {
    after = await physical();
    const documentBytes = [
      ...after.operations,
      ...after.attempts,
      ...after.events,
      ...after.payloads,
    ].map((document) => getDocumentSize(document));
    console.info(
      "BTS317_P01_SETTLEMENT",
      JSON.stringify({
        settlement,
        appendResultBytes,
        physicalEqual: JSON.stringify(after) === beforeBytes,
        counts: {
          operations: after.operations.length,
          attempts: after.attempts.length,
          events: after.events.length,
          payloads: after.payloads.length,
        },
        sequence: after.attempts[0]?.lastSequence,
        documentBytes,
        fetchCalls,
      }),
    );
  }
  expect(fetchCalls).toBe(0);
  // Tiny result assertion avoids dumping a giant resolved receipt on failure.
  expect(settlement).toEqual({
    status: "rejected",
    message: "RENEWAL_JOURNAL_LIMIT",
    messageLength: 21,
  });
  expect(after !== undefined && JSON.stringify(after) === beforeBytes).toBe(
    true,
  );
});

it("P02 refuses an unpaired parsed authorization ID before any writes", async () => {
  let fetchCalls = 0;
  vi.stubGlobal("fetch", () => {
    fetchCalls++;
    throw Error("UNEXPECTED_EXTERNAL_FETCH");
  });
  const recordJSON = JSON.stringify(renewalSnapshot(parsedUnicodeRecord));
  expect(recordJSON).toContain("\\ud800");
  expect(
    Array.from(recordJSON).every((character) => character.charCodeAt(0) < 128),
  ).toBe(true);
  const parsedId: string = JSON.parse(recordJSON).authorization.id;
  expect(parsedId.length).toBe(1);
  expect(parsedId.charCodeAt(0)).toBe(0xd800);
  const metrics = jsonMetrics(JSON.parse(recordJSON));
  expect(metrics.characters).toBeLessThan(ACTOR_JSON_LIMIT);
  expect(metrics.utf8Bytes).toBeLessThan(ACTOR_JSON_LIMIT);
  expect(metrics.nodes).toBeLessThanOrEqual(10000);
  expect(metrics.depth).toBeLessThanOrEqual(40);
  const args = {
    authorizationScope: parsedUnicodeRecord.authorization.scope,
    logicalOperationId: parsedUnicodeRecord.logicalOperationId,
    authorizationRevision: parsedUnicodeRecord.authorization.revision,
    recordJSON,
  };
  const wholeArgsBytes = getConvexSize(args);
  expect(wholeArgsBytes).toBeLessThan(VALUE_LIMIT);
  const t = convexTest(schema, modules);
  async function physical() {
    const [operations, attempts, events, payloads] = await Promise.all([
      t.run((ctx) => ctx.db.query("renewalOperations").take(3)),
      t.run((ctx) => ctx.db.query("renewalOperationAttempts").take(3)),
      t.run((ctx) => ctx.db.query("renewalOperationEvents").take(4)),
      t.run((ctx) => ctx.db.query("renewalOperationPayloads").take(6)),
    ]);
    return { operations, attempts, events, payloads };
  }
  const before = await physical();
  expect(before).toEqual({
    operations: [],
    attempts: [],
    events: [],
    payloads: [],
  });
  const beforeBytes = JSON.stringify(before);
  expect(fetchCalls).toBe(0);
  console.info(
    "BTS317_P02_PREREQUISITES",
    JSON.stringify({
      metrics,
      wholeArgsBytes,
      valueLimit: VALUE_LIMIT,
      parsedIdCodeUnits: [parsedId.charCodeAt(0)],
      rpcStringsASCII: true,
      counts: { operations: 0, attempts: 0, events: 0, payloads: 0 },
      fetchCalls,
    }),
  );
  let settlement:
    | { status: "fulfilled"; resultStatus: string }
    | { status: "rejected"; message: string; messageLength: number }
    | undefined;
  let after: Awaited<ReturnType<typeof physical>> | undefined;
  try {
    const actualReply = await t.mutation(create, args);
    settlement = { status: "fulfilled", resultStatus: actualReply.status };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "NON_ERROR_REJECTION";
    settlement = {
      status: "rejected",
      message: message.slice(0, 200),
      messageLength: message.length,
    };
  } finally {
    after = await physical();
    const documentBytes = [
      ...after.operations,
      ...after.attempts,
      ...after.events,
      ...after.payloads,
    ].map((document) => getDocumentSize(document));
    console.info(
      "BTS317_P02_SETTLEMENT",
      JSON.stringify({
        settlement,
        physicalEqual: JSON.stringify(after) === beforeBytes,
        counts: {
          operations: after.operations.length,
          attempts: after.attempts.length,
          events: after.events.length,
          payloads: after.payloads.length,
        },
        documentBytes,
        fetchCalls,
      }),
    );
  }
  expect(fetchCalls).toBe(0);
  expect(settlement).toEqual({
    status: "rejected",
    message: "RENEWAL_JOURNAL_ENCODING",
    messageLength: 24,
  });
  expect(after !== undefined && JSON.stringify(after) === beforeBytes).toBe(
    true,
  );
});

it("P07 returns complete readable operation DATA within one value envelope", async () => {
  let fetchCalls = 0;
  vi.stubGlobal("fetch", () => {
    fetchCalls++;
    throw Error("UNEXPECTED_EXTERNAL_FETCH");
  });
  const recordJSON = JSON.stringify(renewalSnapshot(record));
  const t = convexTest(schema, modules);
  const creationArgs = {
    authorizationScope: record.authorization.scope,
    authorizationRevision: record.authorization.revision,
    logicalOperationId: record.logicalOperationId,
    recordJSON,
  };
  expect(getConvexSize(creationArgs)).toBeLessThan(VALUE_LIMIT);
  const created = await t.mutation(create, creationArgs);
  expect(created.status).toBe("created");
  expect(getConvexSize(created)).toBeLessThan(VALUE_LIMIT);
  const queryArgs = { operationId: created.operationId };
  expect(getConvexSize(queryArgs)).toBeLessThan(VALUE_LIMIT);
  const prepared = await t.query(load, queryArgs);
  expect(prepared).toEqual({
    operationId: created.operationId,
    recordJSON,
    revision: 0,
    activeAttempt: null,
  });
  expect(getConvexSize(prepared)).toBeLessThan(VALUE_LIMIT);
  const reserveArgs = {
    operationId: created.operationId,
    expectedRevision: 0,
    stage: "attach",
    expectedRequestBinding: record.requestBinding,
    recordJSON,
  };
  expect(getConvexSize(reserveArgs)).toBeLessThan(VALUE_LIMIT);
  const acquired = await t.mutation(reserve, reserveArgs);
  expect(acquired.disposition).toBe("acquired");
  expect(acquired.reservation.recordJSON).toBe(recordJSON);
  expect(acquired.reservation.basisJSON).toBe(
    JSON.stringify(renewalSnapshot(record.basis)),
  );
  const acquiredBytes = getConvexSize(acquired);
  expect(acquiredBytes).toBeLessThan(VALUE_LIMIT);
  // Counterexample construction only. The desired query may remove this duplication.
  const oldShapeBytes = getConvexSize({
    operationId: created.operationId,
    recordJSON,
    revision: 1,
    activeAttempt: acquired.reservation,
  });
  expect(oldShapeBytes).toBeGreaterThan(VALUE_LIMIT);
  const physical = () =>
    Promise.all([
      t.run((ctx) => ctx.db.query("renewalOperations").take(3)),
      t.run((ctx) => ctx.db.query("renewalOperationAttempts").take(3)),
      t.run((ctx) => ctx.db.query("renewalOperationEvents").take(4)),
      t.run((ctx) => ctx.db.query("renewalOperationPayloads").take(6)),
    ]);
  const before = await physical();
  expect(before.map((rows) => rows.length)).toEqual([1, 1, 0, 1]);
  expect(before[0][0].state).toBe("RESERVED");
  expect(before[0][0].revision).toBe(1);
  expect(before[1][0].lastSequence).toBe(0);
  expect(before[3][0].json).toBe(recordJSON);
  const beforeJSON = JSON.stringify(before);
  const documentBytes = before.flatMap((rows) =>
    rows.map((doc) => getDocumentSize(doc)),
  );
  for (const bytes of documentBytes) expect(bytes).toBeLessThan(VALUE_LIMIT);
  expect(fetchCalls).toBe(0);
  console.info(
    "BTS317_P07_PREREQUISITES",
    JSON.stringify({
      basisPadding: BASIS_PADDING,
      canonicalCharacters: recordJSON.length,
      canonicalUTF8Bytes: new TextEncoder().encode(recordJSON).length,
      acquiredBytes,
      oldShapeBytes,
      documentBytes,
      counts: [1, 1, 0, 1],
      fetchCalls,
    }),
  );
  function fullRecordCopies(value: unknown): number {
    if (value === recordJSON) return 1;
    if (value === null || typeof value !== "object") return 0;
    return Object.values(value).reduce<number>(
      (sum, child) => sum + fullRecordCopies(child),
      0,
    );
  }
  let settlement:
    | { status: "fulfilled"; bytes: number }
    | { status: "rejected"; message: string; messageLength: number }
    | undefined;
  let observed:
    | {
        fullRecordEqual: boolean;
        copies: number;
        revision: unknown;
        sameAttempt: boolean;
        sameOperation: boolean;
      }
    | undefined;
  let after: Awaited<ReturnType<typeof physical>> | undefined;
  try {
    const actual = await t.query(load, queryArgs);
    settlement = { status: "fulfilled", bytes: getConvexSize(actual) };
    observed = {
      fullRecordEqual: actual.recordJSON === recordJSON,
      copies: fullRecordCopies(actual),
      revision: actual.revision,
      sameAttempt:
        actual.activeAttempt?.attemptId === acquired.reservation.attemptId,
      sameOperation: actual.operationId === created.operationId,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "NON_ERROR_REJECTION";
    settlement = {
      status: "rejected",
      message: message.slice(0, 200),
      messageLength: message.length,
    };
  } finally {
    after = await physical();
    console.info(
      "BTS317_P07_SETTLEMENT",
      JSON.stringify({
        settlement,
        observed,
        physicalEqual: JSON.stringify(after) === beforeJSON,
        counts: after.map((rows) => rows.length),
        revision: after[0][0]?.revision,
        fetchCalls,
      }),
    );
  }
  expect(fetchCalls).toBe(0);
  expect(settlement?.status).toBe("fulfilled");
  expect(
    settlement?.status === "fulfilled" && settlement.bytes <= VALUE_LIMIT,
  ).toBe(true);
  expect(observed).toEqual({
    fullRecordEqual: true,
    copies: 1,
    revision: 1,
    sameAttempt: true,
    sameOperation: true,
  });
  expect(after !== undefined && JSON.stringify(after) === beforeJSON).toBe(
    true,
  );
});
