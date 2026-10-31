import { getConvexSize, getDocumentSize } from "convex/values";
import { afterEach, expect, it, vi } from "vitest";
import {
  canonicalJournalRecord,
  journalReservationMaterial,
} from "../../shared/renewalOperationJournal.js";
import { prepareRenewalPriceReplacementV2 } from "../../client/billing/renewalV2/index.js";
import {
  canonical,
  codecFixture,
  componentFixture,
  create,
  load,
  VALUE_LIMIT,
  expectInvalidCreate,
} from "./timingPolicy.fixtures.js";

afterEach(() => vi.unstubAllGlobals());

it("CODEC01 preserves complete attach policy DATA without a pre-CAS live basis", async () => {
  await codecFixture();
});

it("CODEC00 keeps the exact legacy v1 normalized return shape", () => {
  const legacy = {
    schemaVersion: 1,
    authorization: { scope: "legacy-host", id: "legacy-consent", revision: 1 },
    logicalOperationId: "legacy-operation",
    requestBinding: "legacy-immutable-DATA",
    originalBundle: { unknown: [null, "retained"] },
    basis: { retainedLegacyDATA: true },
  };
  const json = canonical(legacy);
  expect(canonicalJournalRecord(json)).toEqual({
    json,
    authorizationScope: "legacy-host",
    authorizationId: "legacy-consent",
    authorizationRevision: 1,
    logicalOperationId: "legacy-operation",
    requestBinding: "legacy-immutable-DATA",
  });
});

// Deliberately invalid host DATA, not a claim that malformed raw source is C1.
// This closed set of changes is declared before any fixture constructor runs.
const invalidPolicies = [
  "configure-stage",
  "legacy-null-basis",
  "missing-policy",
  "null-policy",
  "unknown-policy-field",
  "missing-policy-field",
  "wrong-policy-version",
  "unsafe-first-time",
  "negative-period-start",
  "fractional-wall-end",
  "non-number-wall-end",
  "equal-period-end",
  "wall-end-before-work",
  "dispatch-time-mismatch",
  "source-time-mismatch",
  "expected-period-mismatch",
] as const;

it.each(invalidPolicies)(
  "CODEC02 refuses intrinsic %s DATA",
  async (scenario) => {
    const h = await codecFixture();
    const invalid: Record<string, unknown> = JSON.parse(h.recordJSON);
    const policy: Record<string, unknown> = { ...h.record.timingPolicy };
    invalid.timingPolicy = policy;
    switch (scenario) {
      case "configure-stage":
        invalid.stage = "configure";
        break;
      case "legacy-null-basis":
        invalid.basis = null;
        break;
      case "missing-policy":
        delete invalid.timingPolicy;
        break;
      case "null-policy":
        invalid.timingPolicy = null;
        break;
      case "unknown-policy-field":
        policy.extra = null;
        break;
      case "missing-policy-field":
        delete policy.periodStart;
        break;
      case "wrong-policy-version":
        policy.version = 2;
        break;
      case "unsafe-first-time":
        policy.firstDispatchedAt = 9007199254740992;
        invalid.dispatch = {
          ...h.record.dispatch,
          firstDispatchedAt: 9007199254740992,
        };
        invalid.attachRequest = {
          ...h.record.attachRequest,
          firstDispatchedAt: 9007199254740992,
        };
        break;
      case "negative-period-start":
        policy.periodStart = -1;
        invalid.attachRequest = {
          ...h.record.attachRequest,
          preparation: {
            ...h.record.attachRequest.preparation,
            expected: {
              ...h.record.attachRequest.preparation.expected,
              periodStart: -1,
            },
          },
        };
        break;
      case "fractional-wall-end":
        policy.endWallMs = 1700000006000.5;
        break;
      case "non-number-wall-end":
        policy.endWallMs = "1700000006000";
        break;
      case "equal-period-end":
        policy.periodEnd = policy.periodStart;
        invalid.attachRequest = {
          ...h.record.attachRequest,
          preparation: {
            ...h.record.attachRequest.preparation,
            expected: {
              ...h.record.attachRequest.preparation.expected,
              periodEnd: h.record.timingPolicy.periodStart,
            },
          },
        };
        break;
      case "wall-end-before-work":
        policy.endWallMs = h.record.timingPolicy.workEndWallMs - 1;
        break;
      case "dispatch-time-mismatch":
        invalid.dispatch = {
          ...h.record.dispatch,
          firstDispatchedAt: 1700000002,
        };
        break;
      case "source-time-mismatch":
        invalid.attachRequest = {
          ...h.record.attachRequest,
          firstDispatchedAt: 1700000002,
        };
        break;
      case "expected-period-mismatch":
        invalid.attachRequest = {
          ...h.record.attachRequest,
          preparation: {
            ...h.record.attachRequest.preparation,
            expected: {
              ...h.record.attachRequest.preparation.expected,
              periodEnd: 1702592001,
            },
          },
        };
        break;
    }
    try {
      const json = canonical(invalid);
      expect(json.length).toBeLessThanOrEqual(500000);
      expect(new TextEncoder().encode(json).length).toBeLessThanOrEqual(500000);
      expect(() => canonicalJournalRecord(json)).toThrow(
        "RENEWAL_JOURNAL_JSON_STOP",
      );
      expect(canonical(h.record)).toBe(h.recordJSON);
    } finally {
      expect(h.fetchCalls()).toBe(0);
    }
  },
);

it("MAT01 returns policy-only V2 reservation DATA without basisJSON", async () => {
  const h = await codecFixture();
  try {
    const full = canonicalJournalRecord(h.recordJSON);
    expect(full).toEqual(h.normalized);
    const material = journalReservationMaterial(full);
    expect(material).toEqual({
      recordVersion: 2,
      stage: "attach",
      key: h.request.key,
      apiVersion: h.request.apiVersion,
      firstDispatchedAt: h.request.firstDispatchedAt,
      accountJSON: canonical(h.record.account),
      timingPolicyJSON: canonical(h.record.timingPolicy),
    });
    expect(Object.prototype.hasOwnProperty.call(material, "basisJSON")).toBe(
      false,
    );
    expect(canonical(h.record)).toBe(h.recordJSON);
  } finally {
    expect(h.fetchCalls()).toBe(0);
  }
});

it("MAT00 keeps the exact legacy v1 material shape", async () => {
  const h = await codecFixture();
  const basis = {
    startWallMs: 1700000001000,
    startNs: "1700000001000000000",
    workEndWallMs: 1700000005000,
    workEndNs: "1700000005000000000",
    endWallMs: 1700000006000,
    endNs: "1700000006000000000",
  };
  const legacy: Record<string, unknown> = {
    ...h.record,
    schemaVersion: 1,
    basis,
  };
  delete legacy.timingPolicy;
  const legacyJSON = canonical(legacy);
  try {
    expect(
      journalReservationMaterial(canonicalJournalRecord(legacyJSON)),
    ).toEqual({
      stage: "attach",
      key: h.request.key,
      apiVersion: h.request.apiVersion,
      firstDispatchedAt: h.request.firstDispatchedAt,
      accountJSON: canonical(h.record.account),
      basisJSON: canonical(basis),
    });
  } finally {
    expect(h.fetchCalls()).toBe(0);
  }
});

const invalidSourcePeriodEnd = 1702592001;

it("V2CREATE01 retains V2 owned header and versioned PREPARED load DATA", async () => {
  const h = await codecFixture();
  const { t, physical } = componentFixture();
  const args = {
    authorizationScope: h.record.authorization.scope,
    logicalOperationId: h.record.logicalOperationId,
    authorizationRevision: h.record.authorization.revision,
    recordJSON: h.recordJSON,
  };
  expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
  expect(await physical()).toEqual({
    operations: [],
    attempts: [],
    events: [],
    payloads: [],
  });
  let stable: string | undefined;
  let targetFailed = false;
  try {
    const created = await t.mutation(create, args);
    expect(created.status).toBe("created");
    expect(getConvexSize(created)).toBeLessThanOrEqual(VALUE_LIMIT);
    const stored = await physical();
    stable = JSON.stringify(stored);
    expect(stored.operations).toHaveLength(1);
    expect(stored.payloads).toHaveLength(1);
    expect(stored.attempts).toHaveLength(0);
    expect(stored.events).toHaveLength(0);
    for (const rows of Object.values(stored)) {
      for (const row of rows)
        expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
    }
    const operation = stored.operations[0];
    const payload = stored.payloads[0];
    expect(operation).toMatchObject({
      _id: created.operationId,
      payloadId: payload._id,
      requestBinding: h.record.requestBinding,
      revision: 0,
      state: "PREPARED",
    });
    expect(payload).toMatchObject({
      codecVersion: 1,
      json: h.recordJSON,
      owner: { kind: "operation", operationId: created.operationId },
    });
    // First missing behavior: actual owned operation header must retain V2.
    expect(operation).toMatchObject({ recordVersion: 2 });
    const queryArgs = { operationId: created.operationId };
    expect(getConvexSize(queryArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
    const loaded = await t.query(load, queryArgs);
    expect(getConvexSize(loaded)).toBeLessThanOrEqual(VALUE_LIMIT);
    expect(loaded).toEqual({
      recordVersion: 2,
      operationId: created.operationId,
      recordJSON: h.recordJSON,
      revision: 0,
      activeAttempt: null,
      initialBasis: null,
    });
    expect(JSON.parse(loaded.recordJSON)).toEqual(h.record);
  } catch (error) {
    targetFailed = true;
    throw error;
  } finally {
    try {
      const after = await physical();
      console.info(
        "V2CREATE01_SETTLEMENT",
        JSON.stringify({
          physicalEqual:
            stable !== undefined && JSON.stringify(after) === stable,
          rows: Object.fromEntries(
            Object.entries(after).map(([key, rows]) => [key, rows.length]),
          ),
          fetchCalls: h.fetchCalls(),
        }),
      );
      if (stable !== undefined) expect(JSON.stringify(after)).toBe(stable);
      expect(h.fetchCalls()).toBe(0);
    } catch (inspectionError) {
      if (!targetFailed) throw inspectionError;
      console.info("V2CREATE01_READONLY_INSPECTION_FAILED");
    }
  }
});

it("V2CREATE02 refuses invalid complete C1 source before any committed DATA writes", async () => {
  const h = await codecFixture();
  // Declared invalid host DATA: expected period/policy remain unchanged.
  // It is not a qualified C1 record despite passing intrinsic policy checks.
  const invalid = structuredClone(h.record);
  const item = invalid.attachRequest.preparation.subscription.items.data[0];
  expect(item.current_period_end).toBe(1702592000);
  item.current_period_end = invalidSourcePeriodEnd;
  await expect(
    prepareRenewalPriceReplacementV2(invalid.attachRequest.preparation),
  ).rejects.toThrow(
    "Renewal replacement does not match the authorized original and target.",
  );
  const recordJSON = canonical(invalid);
  expect(recordJSON.length).toBeLessThanOrEqual(500000);
  expect(new TextEncoder().encode(recordJSON).length).toBeLessThanOrEqual(
    500000,
  );
  expect(canonicalJournalRecord(recordJSON)).toMatchObject({
    recordVersion: 2,
    json: recordJSON,
  });
  await expectInvalidCreate(h, recordJSON, "V2CREATE02");
});

// Closed host-DATA mutations; the complete raw C1 input stays untouched.
const invalidRequests = [
  {
    name: "payload",
    dispatch: { payload: { from_subscription: "sub_other" } },
  },
  { name: "key", dispatch: { key: "attach:other" } },
  { name: "path", dispatch: { path: "/v1/subscription_schedules/other" } },
  { name: "extra-wire-key", dispatch: { extra: null } },
  {
    name: "root-binding",
    root: { requestBinding: "not-the-actual-C2-binding" },
  },
  {
    name: "root-account",
    root: {
      account: { mode: "platform", stripeAccount: null, livemode: true },
    },
  },
  { name: "root-api", root: { apiVersion: "2026-08-27.dahlia" } },
] as const;

it.each(invalidRequests)(
  "V2CREATE03 refuses full C2/root $name mismatch",
  async (scenario) => {
    const h = await codecFixture();
    const root = "root" in scenario ? scenario.root : {};
    const wire = "dispatch" in scenario ? scenario.dispatch : {};
    const invalid = {
      ...h.record,
      ...root,
      dispatch: { ...h.record.dispatch, ...wire },
    };
    expect(canonical(invalid.attachRequest)).toBe(
      canonical(h.record.attachRequest),
    );
    // Prove the raw C1 input remains valid independently of the component target.
    await expect(
      prepareRenewalPriceReplacementV2(invalid.attachRequest.preparation),
    ).resolves.toMatchObject({ version: 2 });
    const recordJSON = canonical(invalid);
    expect(recordJSON.length).toBeLessThanOrEqual(500000);
    expect(new TextEncoder().encode(recordJSON).length).toBeLessThanOrEqual(
      500000,
    );
    expect(canonicalJournalRecord(recordJSON)).toMatchObject({
      recordVersion: 2,
      json: recordJSON,
    });
    await expectInvalidCreate(h, recordJSON, `V2CREATE03_${scenario.name}`);
  },
);

// Fixed stored-DATA corruption recipes, declared before fixture constructors.
const storedIntegrityCases = [
  "invalid-actual-C1",
  "missing-V2-header",
  "legacy-source-V2-header",
] as const;

it.each(storedIntegrityCases)(
  "V2READ01 refuses stored %s without repairing DATA",
  async (scenario) => {
    const h = await codecFixture();
    const { t, physical } = componentFixture();
    const args = {
      authorizationScope: h.record.authorization.scope,
      logicalOperationId: h.record.logicalOperationId,
      authorizationRevision: h.record.authorization.revision,
      recordJSON: h.recordJSON,
    };
    expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
    const created = await t.mutation(create, args);
    expect(created.status).toBe("created");
    const queryArgs = { operationId: created.operationId };
    expect(getConvexSize(queryArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
    const loaded = await t.query(load, queryArgs);
    expect(getConvexSize(loaded)).toBeLessThanOrEqual(VALUE_LIMIT);
    expect(loaded).toEqual({
      recordVersion: 2,
      operationId: created.operationId,
      recordJSON: h.recordJSON,
      revision: 0,
      activeAttempt: null,
      initialBasis: null,
    });
    const valid = await physical();
    expect(valid.operations).toHaveLength(1);
    expect(valid.attempts).toHaveLength(0);
    expect(valid.events).toHaveLength(0);
    expect(valid.payloads).toHaveLength(1);
    const operation = valid.operations[0];
    const payload = valid.payloads[0];
    expect(operation._id).toBe(created.operationId);
    expect(operation.recordVersion).toBe(2);
    expect(operation.payloadId).toBe(payload._id);
    expect(payload.json).toBe(h.recordJSON);
    expect(payload.owner).toEqual({
      kind: "operation",
      operationId: created.operationId,
    });
    if (scenario === "invalid-actual-C1") {
      const invalid = structuredClone(h.record);
      const item = invalid.attachRequest.preparation.subscription.items.data[0];
      expect(item.current_period_end).toBe(1702592000);
      item.current_period_end = invalidSourcePeriodEnd;
      expect(invalid.timingPolicy).toEqual(h.record.timingPolicy);
      expect(invalid.attachRequest.preparation.expected).toEqual(
        h.record.attachRequest.preparation.expected,
      );
      const json = canonical(invalid);
      expect(canonicalJournalRecord(json)).toMatchObject({
        json,
        recordVersion: 2,
      });
      await expect(
        prepareRenewalPriceReplacementV2(invalid.attachRequest.preparation),
      ).rejects.toThrow(
        "Renewal replacement does not match the authorized original and target.",
      );
      await t.run((ctx) =>
        ctx.db.patch("renewalOperationPayloads", payload._id, { json }),
      );
    } else if (scenario === "missing-V2-header") {
      await t.run((ctx) =>
        ctx.db.patch("renewalOperations", operation._id, {
          recordVersion: undefined,
        }),
      );
    } else {
      const legacy: Record<string, unknown> = {
        ...h.record,
        schemaVersion: 1,
        basis: { retainedLegacyDATA: true },
      };
      delete legacy.timingPolicy;
      const json = canonical(legacy);
      expect(canonicalJournalRecord(json)).toEqual({
        json,
        authorizationScope: h.record.authorization.scope,
        authorizationId: h.record.authorization.id,
        authorizationRevision: h.record.authorization.revision,
        logicalOperationId: h.record.logicalOperationId,
        requestBinding: h.record.requestBinding,
      });
      await t.run((ctx) =>
        ctx.db.patch("renewalOperationPayloads", payload._id, { json }),
      );
    }
    const afterPatch = await physical();
    expect(afterPatch).not.toEqual(valid);
    for (const rows of Object.values(afterPatch)) {
      for (const row of rows)
        expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
    }
    let targetFailed = false;
    try {
      await expect(t.query(load, queryArgs)).rejects.toThrow(
        /^RENEWAL_JOURNAL_CONFLICT$/,
      );
    } catch (error) {
      targetFailed = true;
      throw error;
    } finally {
      try {
        expect(await physical()).toEqual(afterPatch);
        expect(h.fetchCalls()).toBe(0);
      } catch (inspectionError) {
        if (!targetFailed) throw inspectionError;
        console.info("V2READ01_READONLY_INSPECTION_FAILED");
      }
    }
  },
);
