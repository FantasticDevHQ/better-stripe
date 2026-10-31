import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { getConvexSize, getDocumentSize } from "convex/values";
import { afterEach, expect, it, vi } from "vitest";
import { modules, schema } from "../../test.js";
import { canonicalFingerprint } from "../operationEvidence/canonical.js";
import { canonicalJournalRecord } from "../../shared/renewalOperationJournal.js";
import { renewalSnapshot } from "../../client/billing/renewalReplacementSnapshot.js";

const VALUE_LIMIT = 1048576;
// Independent immutable storage DATA. No maintained provider/Owner applicability.
const base = Object.freeze({
  schemaVersion: 1,
  requestBinding: "encoding-consistency-A",
  authorization: Object.freeze({
    scope: "encoding-merchant",
    id: "encoding-consent",
    revision: 1,
  }),
  logicalOperationId: "encoding-base",
  stage: "attach",
  account: Object.freeze({
    mode: "platform",
    stripeAccount: null,
    livemode: false,
  }),
  apiVersion: "2026-09-30.endive",
  profile: "unqualified-encoding-DATA",
  subscriptionId: "sub_encoding",
  customerId: "cus_encoding",
  itemId: "si_encoding",
  currentPriceId: "price_old",
  targetPriceId: "price_new",
  targetProductId: "prod_new",
  period: Object.freeze({ start: 2000000000, end: 2000003600 }),
  dispatch: Object.freeze({
    scope: "platform",
    apiVersion: "2026-09-30.endive",
    method: "POST",
    path: "/v1/subscription_schedules",
    payload: Object.freeze({ from_subscription: "sub_encoding" }),
    key: "retained-encoding-key",
    firstDispatchedAt: 2000000000,
  }),
  options: Object.freeze({ maxNetworkRetries: 0, redirect: "error" }),
  originalBundle: Object.freeze({
    subscription: Object.freeze({
      id: "sub_encoding",
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
  }),
});
const badKey = Object.freeze({
  ...base,
  logicalOperationId: "encoding-key",
  dispatch: Object.freeze({ ...base.dispatch, key: "\ud800" }),
});
const badAPI = Object.freeze({
  ...base,
  logicalOperationId: "encoding-api",
  apiVersion: "\ud800",
  dispatch: Object.freeze({ ...base.dispatch, apiVersion: "\ud800" }),
});
const pairedHeader = Object.freeze({
  ...base,
  logicalOperationId: "encoding-paired",
  authorization: Object.freeze({
    ...base.authorization,
    id: "consent-\u00e9-\ud83d\ude80",
  }),
});
const escapedNested = Object.freeze({
  ...base,
  logicalOperationId: "encoding-nested",
  originalBundle: Object.freeze({
    ...base.originalBundle,
    subscription: Object.freeze({
      ...base.originalBundle.subscription,
      metadata: Object.freeze({
        ...base.originalBundle.subscription.metadata,
        unpaired: "\ud800",
      }),
    }),
  }),
});

const create = makeFunctionReference<"mutation">(
  "renewalOperations/mutations:createAuthorizedOperation",
);
const load = makeFunctionReference<"query">(
  "renewalOperations/queries:loadAuthorizedOperation",
);
const reserve = makeFunctionReference<"mutation">(
  "renewalOperations/mutations:reserveAttempt",
);
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  let calls = 0;
  vi.stubGlobal("fetch", () => {
    calls++;
    throw Error("UNEXPECTED_EXTERNAL_FETCH");
  });
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
  return { t, physical, fetchCalls: () => calls };
}
function wireRecord(value: unknown) {
  const canonicalJSON = JSON.stringify(renewalSnapshot(value));
  const wireJSON = canonicalJSON
    .split("\ud83d\ude80")
    .join("\\ud83d\\ude80")
    .split("\u00e9")
    .join("\\u00e9");
  expect(
    Array.from(wireJSON).every((character) => character.charCodeAt(0) < 128),
  ).toBe(true);
  return { canonicalJSON, wireJSON };
}

async function refusedAttempt(
  candidate: typeof badKey | typeof badAPI,
  field: "key" | "apiVersion",
) {
  const { canonicalJSON, wireJSON } = wireRecord(candidate);
  const normalized = canonicalJournalRecord(wireJSON);
  expect(normalized.json).toBe(canonicalJSON);
  expect(normalized.authorizationScope).toBe(base.authorization.scope);
  expect(normalized.authorizationId).toBe(base.authorization.id);
  expect(normalized.authorizationRevision).toBe(base.authorization.revision);
  expect(normalized.logicalOperationId).toBe(candidate.logicalOperationId);
  expect(normalized.requestBinding).toBe(base.requestBinding);
  const parsed: typeof candidate = JSON.parse(wireJSON);
  expect(parsed).toEqual(candidate);
  const invalid = field === "key" ? parsed.dispatch.key : parsed.apiVersion;
  expect(invalid.length).toBe(1);
  expect(invalid.charCodeAt(0)).toBe(0xd800);
  expect(parsed.dispatch.scope).toBe(parsed.account.mode);
  expect(parsed.dispatch.apiVersion).toBe(parsed.apiVersion);
  expect(parsed.dispatch.firstDispatchedAt).toBe(
    base.dispatch.firstDispatchedAt,
  );
  expect(wireJSON.length).toBeLessThan(500000);
  expect(new TextEncoder().encode(wireJSON).length).toBeLessThan(500000);
  // A real existing SHA256 DATA fingerprint; not C1/provider/authorization proof.
  const fingerprint = await canonicalFingerprint(canonicalJSON);
  expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  const { t, physical, fetchCalls } = fixture();
  const creationArgs = {
    authorizationScope: candidate.authorization.scope,
    authorizationRevision: candidate.authorization.revision,
    logicalOperationId: candidate.logicalOperationId,
    recordJSON: wireJSON,
  };
  expect(getConvexSize(creationArgs)).toBeLessThan(VALUE_LIMIT);
  const created = await t.mutation(create, creationArgs);
  expect(created.status).toBe("created");
  const loaded = await t.query(load, { operationId: created.operationId });
  expect(loaded).toEqual({
    operationId: created.operationId,
    recordJSON: canonicalJSON,
    revision: 0,
    activeAttempt: null,
  });
  const before = await physical();
  expect(before.operations).toHaveLength(1);
  expect(before.attempts).toHaveLength(0);
  expect(before.events).toHaveLength(0);
  expect(before.payloads).toHaveLength(1);
  expect(before.operations[0].revision).toBe(0);
  expect(before.operations[0].state).toBe("PREPARED");
  expect(before.operations[0].authorizationId).toBe(base.authorization.id);
  expect(before.payloads[0].json).toBe(canonicalJSON);
  const beforeJSON = JSON.stringify(before);
  const args = {
    operationId: created.operationId,
    expectedRevision: 0,
    stage: "attach",
    expectedRequestBinding: candidate.requestBinding,
    recordJSON: wireJSON,
  };
  const wholeArgsBytes = getConvexSize(args);
  expect(wholeArgsBytes).toBeLessThan(VALUE_LIMIT);
  const beforeDocumentBytes = [...before.operations, ...before.payloads].map(
    (doc) => getDocumentSize(doc),
  );
  for (const bytes of beforeDocumentBytes)
    expect(bytes).toBeLessThan(VALUE_LIMIT);
  expect(fetchCalls()).toBe(0);
  console.info(
    "BTS317_ATTEMPT_ENCODING_PREREQUISITES",
    JSON.stringify({
      field,
      wholeArgsBytes,
      canonicalCharacters: canonicalJSON.length,
      canonicalUTF8Bytes: new TextEncoder().encode(canonicalJSON).length,
      fingerprintLength: fingerprint.length,
      invalidCodeUnit: invalid.charCodeAt(0),
      beforeDocumentBytes,
      counts: { operations: 1, attempts: 0, events: 0, payloads: 1 },
      fetchCalls: fetchCalls(),
    }),
  );
  let settlement:
    | { status: "fulfilled"; disposition: string }
    | { status: "rejected"; message: string; messageLength: number }
    | undefined;
  let after: Awaited<ReturnType<typeof physical>> | undefined;
  try {
    const result = await t.mutation(reserve, args);
    settlement = { status: "fulfilled", disposition: result.disposition };
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
      "BTS317_ATTEMPT_ENCODING_SETTLEMENT",
      JSON.stringify({
        field,
        settlement,
        physicalEqual: JSON.stringify(after) === beforeJSON,
        counts: {
          operations: after.operations.length,
          attempts: after.attempts.length,
          events: after.events.length,
          payloads: after.payloads.length,
        },
        revision: after.operations[0]?.revision,
        documentBytes: [
          ...after.operations,
          ...after.attempts,
          ...after.events,
          ...after.payloads,
        ].map((doc) => getDocumentSize(doc)),
        fetchCalls: fetchCalls(),
      }),
    );
  }
  expect(fetchCalls()).toBe(0);
  expect(settlement).toEqual({
    status: "rejected",
    message: "RENEWAL_JOURNAL_ENCODING",
    messageLength: 24,
  });
  expect(after !== undefined && JSON.stringify(after) === beforeJSON).toBe(
    true,
  );
}

it("P03 refuses an unpaired parsed attempt key after valid creation", async () => {
  await refusedAttempt(badKey, "key");
});
it("P04 refuses an unpaired parsed attempt API version after valid creation", async () => {
  await refusedAttempt(badAPI, "apiVersion");
});
it("P05 preserves valid Unicode and a paired surrogate in a creation header", async () => {
  const { canonicalJSON, wireJSON } = wireRecord(pairedHeader);
  const { t, physical, fetchCalls } = fixture();
  const created = await t.mutation(create, {
    authorizationScope: pairedHeader.authorization.scope,
    authorizationRevision: pairedHeader.authorization.revision,
    logicalOperationId: pairedHeader.logicalOperationId,
    recordJSON: wireJSON,
  });
  expect(created.status).toBe("created");
  const loaded = await t.query(load, { operationId: created.operationId });
  expect(loaded).toEqual({
    operationId: created.operationId,
    recordJSON: canonicalJSON,
    revision: 0,
    activeAttempt: null,
  });
  const stored = await physical();
  expect(stored.operations).toHaveLength(1);
  expect(stored.payloads).toHaveLength(1);
  expect(stored.attempts).toHaveLength(0);
  expect(stored.events).toHaveLength(0);
  expect(stored.operations[0].authorizationId).toBe(
    pairedHeader.authorization.id,
  );
  expect(stored.payloads[0].json).toBe(canonicalJSON);
  const id = stored.operations[0].authorizationId;
  expect(id.charCodeAt(id.length - 2)).toBe(0xd83d);
  expect(id.charCodeAt(id.length - 1)).toBe(0xde80);
  expect(id.includes("\u00e9")).toBe(true);
  for (const doc of [...stored.operations, ...stored.payloads])
    expect(getDocumentSize(doc)).toBeLessThan(VALUE_LIMIT);
  expect(fetchCalls()).toBe(0);
});
it("P06 preserves an escaped unpaired value nested only inside retained JSON", async () => {
  const { canonicalJSON, wireJSON } = wireRecord(escapedNested);
  expect(wireJSON).toContain("\\ud800");
  const { t, physical, fetchCalls } = fixture();
  const created = await t.mutation(create, {
    authorizationScope: escapedNested.authorization.scope,
    authorizationRevision: escapedNested.authorization.revision,
    logicalOperationId: escapedNested.logicalOperationId,
    recordJSON: wireJSON,
  });
  expect(created.status).toBe("created");
  const loaded = await t.query(load, { operationId: created.operationId });
  expect(loaded.recordJSON).toBe(canonicalJSON);
  expect(JSON.parse(loaded.recordJSON)).toEqual(escapedNested);
  const nested: string = JSON.parse(loaded.recordJSON).originalBundle
    .subscription.metadata.unpaired;
  expect(nested.length).toBe(1);
  expect(nested.charCodeAt(0)).toBe(0xd800);
  const stored = await physical();
  expect(stored.operations).toHaveLength(1);
  expect(stored.payloads).toHaveLength(1);
  expect(stored.attempts).toHaveLength(0);
  expect(stored.events).toHaveLength(0);
  expect(stored.operations[0].authorizationId).toBe(base.authorization.id);
  expect(stored.payloads[0].json).toBe(canonicalJSON);
  for (const doc of [...stored.operations, ...stored.payloads])
    expect(getDocumentSize(doc)).toBeLessThan(VALUE_LIMIT);
  expect(fetchCalls()).toBe(0);
});

// All six recipes and complete near-cap records are declared before fixtures.
// Large indexed scope is emulator-only until native index limits are qualified.
const loadBoundaryRecipes = [
  ["basis", 'é🚀\\"\n'],
  ["account", "🚀é\t\\"],
  ["authorization-scope", 'é🚀"\\'],
  ["authorization-id", '🚀é\n"'],
  ["key", "é🚀\\\t"],
  ["request-binding", '🚀é"\n'],
] as const;
type LoadBoundaryField = (typeof loadBoundaryRecipes)[number][0];
function boundaryRecord(field: LoadBoundaryField, padding: string) {
  return {
    ...base,
    logicalOperationId: `load-boundary-${field}`,
    requestBinding: field === "request-binding" ? padding : base.requestBinding,
    basis: {
      ...base.basis,
      boundaryPadding: field === "basis" ? padding : "",
    },
    account: {
      ...base.account,
      boundaryPadding: field === "account" ? padding : "",
    },
    authorization: {
      ...base.authorization,
      scope:
        field === "authorization-scope" ? padding : base.authorization.scope,
      id: field === "authorization-id" ? padding : base.authorization.id,
    },
    dispatch: {
      ...base.dispatch,
      key: field === "key" ? padding : base.dispatch.key,
    },
  };
}
const loadBoundaryCases = loadBoundaryRecipes.map(([name, unit]) => {
  const utf8 = new TextEncoder();
  const emptyBytes = utf8.encode(
    JSON.stringify(renewalSnapshot(boundaryRecord(name, ""))),
  ).length;
  const unitJSONBytes = utf8.encode(JSON.stringify(unit)).length - 2;
  const count = Math.floor((499900 - emptyBytes) / unitJSONBytes);
  const record = boundaryRecord(name, unit.repeat(count));
  const recordJSON = JSON.stringify(renewalSnapshot(record));
  return Object.freeze({ name, record, recordJSON, unitJSONBytes });
});

it.each(loadBoundaryCases)(
  "P08 near-cap complete load retains every field for $name",
  async ({ name, record, recordJSON, unitJSONBytes }) => {
    // Pure declared UTF8 construction, never adjusted after an RPC response.
    const bytes = new TextEncoder().encode(recordJSON).length;
    expect(bytes).toBeGreaterThanOrEqual(499900 - unitJSONBytes);
    expect(bytes).toBeLessThanOrEqual(499900);
    expect(recordJSON.length).toBeLessThanOrEqual(500000);
    expect(bytes).toBeLessThanOrEqual(500000);
    expect(recordJSON).toContain("é");
    expect(recordJSON).toContain("🚀");
    expect(recordJSON).toMatch(/\\["\\nt]/);
    const canonical = canonicalJournalRecord(recordJSON);
    expect(canonical.json).toBe(recordJSON);
    const { t, physical, fetchCalls } = fixture();
    const creationArgs = {
      authorizationScope: record.authorization.scope,
      authorizationRevision: record.authorization.revision,
      logicalOperationId: record.logicalOperationId,
      recordJSON,
    };
    expect(getConvexSize(creationArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
    const created = await t.mutation(create, creationArgs);
    expect(created.status).toBe("created");
    expect(getConvexSize(created)).toBeLessThanOrEqual(VALUE_LIMIT);
    const queryArgs = { operationId: created.operationId };
    expect(getConvexSize(queryArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
    const prepared = await t.query(load, queryArgs);
    expect(prepared).toEqual({
      operationId: created.operationId,
      recordJSON,
      revision: 0,
      activeAttempt: null,
    });
    expect(getConvexSize(prepared)).toBeLessThanOrEqual(VALUE_LIMIT);
    const preparedRows = await physical();
    expect(preparedRows.operations).toHaveLength(1);
    expect(preparedRows.attempts).toHaveLength(0);
    expect(preparedRows.events).toHaveLength(0);
    expect(preparedRows.payloads).toHaveLength(1);
    for (const rows of Object.values(preparedRows))
      for (const doc of rows)
        expect(getDocumentSize(doc)).toBeLessThanOrEqual(VALUE_LIMIT);
    const reserveArgs = {
      operationId: created.operationId,
      expectedRevision: 0,
      stage: "attach",
      expectedRequestBinding: record.requestBinding,
      recordJSON,
    };
    expect(getConvexSize(reserveArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
    const acquired = await t.mutation(reserve, reserveArgs);
    expect(acquired.disposition).toBe("acquired");
    expect(getConvexSize(acquired)).toBeLessThanOrEqual(VALUE_LIMIT);
    expect(acquired.reservation.recordJSON).toBe(recordJSON);
    expect(acquired.reservation.basisJSON).toBe(
      JSON.stringify(renewalSnapshot(record.basis)),
    );
    expect(acquired.reservation.accountJSON).toBe(
      JSON.stringify(renewalSnapshot(record.account)),
    );
    expect(acquired.reservation.authorizationScope).toBe(
      record.authorization.scope,
    );
    expect(acquired.reservation.authorizationId).toBe(record.authorization.id);
    expect(acquired.reservation.key).toBe(record.dispatch.key);
    expect(acquired.reservation.requestBinding).toBe(record.requestBinding);
    const { recordJSON: reservationJSON, ...expectedSummary } =
      acquired.reservation;
    expect(reservationJSON).toBe(recordJSON);
    expect(Object.keys(expectedSummary)).toHaveLength(17);
    const beforeLoad = await physical();
    const beforeLoadJSON = JSON.stringify(beforeLoad);
    const loaded = await t.query(load, queryArgs);
    expect(getConvexSize(loaded)).toBeLessThanOrEqual(VALUE_LIMIT);
    expect(loaded).toEqual({
      operationId: created.operationId,
      recordJSON,
      revision: 1,
      activeAttempt: expectedSummary,
    });
    expect(JSON.parse(loaded.recordJSON)).toEqual(record);
    expect(
      Object.prototype.hasOwnProperty.call(loaded.activeAttempt, "recordJSON"),
    ).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(loaded, "acquired")).toBe(
      false,
    );
    function completeRecordCopies(value: unknown): number {
      if (value === recordJSON) return 1;
      if (value === null || typeof value !== "object") return 0;
      return Object.values(value).reduce<number>(
        (sum, child) => sum + completeRecordCopies(child),
        0,
      );
    }
    expect(completeRecordCopies(loaded)).toBe(1);
    const stored = await physical();
    expect(JSON.stringify(stored)).toBe(beforeLoadJSON);
    expect(stored.operations).toHaveLength(1);
    expect(stored.attempts).toHaveLength(1);
    expect(stored.events).toHaveLength(0);
    expect(stored.payloads).toHaveLength(1);
    expect(stored.payloads[0].json).toBe(recordJSON);
    expect(stored.operations[0].revision).toBe(1);
    expect(stored.attempts[0]._id).toBe(expectedSummary.attemptId);
    const documentBytes = Object.values(stored).flatMap((rows) =>
      rows.map((doc) => getDocumentSize(doc)),
    );
    for (const size of documentBytes)
      expect(size).toBeLessThanOrEqual(VALUE_LIMIT);
    expect(fetchCalls()).toBe(0);
    console.info(
      "BTS317_LOAD_BOUNDARY",
      JSON.stringify({
        name,
        canonicalCharacters: recordJSON.length,
        canonicalUTF8Bytes: bytes,
        creationArgsBytes: getConvexSize(creationArgs),
        reserveArgsBytes: getConvexSize(reserveArgs),
        acquiredBytes: getConvexSize(acquired),
        loadedBytes: getConvexSize(loaded),
        documentBytes,
        counts: [1, 1, 0, 1],
        fetchCalls: fetchCalls(),
      }),
    );
  },
);

it("OWN01 unowned committed source payload refuses load without repair", async () => {
  const { t, physical, fetchCalls } = fixture();
  const { canonicalJSON: json, wireJSON } = wireRecord(base);
  expect(canonicalJournalRecord(wireJSON).json).toBe(json);
  const args = {
    authorizationScope: base.authorization.scope,
    logicalOperationId: base.logicalOperationId,
    authorizationRevision: base.authorization.revision,
    recordJSON: wireJSON,
  };
  const created = await t.mutation(create, args);
  expect(created.status).toBe("created");
  const queryArgs = { operationId: created.operationId };
  const original = await t.query(load, queryArgs);
  expect(original.recordJSON).toBe(json);
  expect(JSON.parse(original.recordJSON)).toEqual(base);
  const rows = await physical();
  expect(rows.operations).toHaveLength(1);
  expect(rows.payloads).toHaveLength(1);
  const payloadId = rows.operations[0].payloadId;
  expect(rows.payloads[0]._id).toBe(payloadId);
  expect(rows.payloads[0].json).toBe(json);
  // Controlled damaged fixture: preserve complete JSON, remove all owner data.
  await t.run((ctx) =>
    ctx.db.replace("renewalOperationPayloads", payloadId, {
      codecVersion: 1,
      json,
    }),
  );
  const damaged = await physical();
  expect(damaged.payloads[0].json).toBe(json);
  expect(Object.keys(damaged.payloads[0]).sort()).toEqual([
    "_creationTime",
    "_id",
    "codecVersion",
    "json",
  ]);
  try {
    await expect(t.query(load, queryArgs)).rejects.toThrow(
      "RENEWAL_JOURNAL_CONFLICT",
    );
  } finally {
    expect(JSON.stringify(await physical()) === JSON.stringify(damaged)).toBe(
      true,
    );
    expect(fetchCalls()).toBe(0);
  }
});
it("OWN02 parent abort rolls back registered create operation and payload", async () => {
  const { t, physical, fetchCalls } = fixture();
  const empty = await physical();
  expect(Object.values(empty).map((rows) => rows.length)).toEqual([0, 0, 0, 0]);
  const args = {
    authorizationScope: base.authorization.scope,
    logicalOperationId: base.logicalOperationId,
    authorizationRevision: base.authorization.revision,
    recordJSON: JSON.stringify(renewalSnapshot(base)),
  };
  let receivedCreated = false;
  await expect(
    t.mutation(async (ctx) => {
      const reply = await ctx.runMutation(create, args);
      expect(reply.status).toBe("created");
      expect(typeof reply.operationId).toBe("string");
      receivedCreated = true;
      throw Error("OWN_PARENT_ABORT_AFTER_CREATED");
    }),
  ).rejects.toThrow("OWN_PARENT_ABORT_AFTER_CREATED");
  expect(receivedCreated).toBe(true);
  expect(await physical()).toEqual(empty);
  expect(fetchCalls()).toBe(0);
});
