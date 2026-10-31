import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { getConvexSize } from "convex/values";
import { expect, vi } from "vitest";
import { modules, schema } from "../../test.js";
import { canonicalJournalRecord } from "../../shared/renewalOperationJournal.js";
import { renewalSnapshot } from "../../client/billing/renewalReplacementSnapshot.js";
import {
  prepareRenewalPriceReplacementV2,
  prepareRenewalScheduleAttachmentV2,
} from "../../client/billing/renewalV2/index.js";
import { receiptInput } from "../../client/billing/renewalAttach/internal/acquisition/test-fixtures/fixture.mjs";

export const canonical = (value: unknown) =>
  JSON.stringify(renewalSnapshot(value));

export async function codecFixture() {
  let fetchCalls = 0;
  vi.stubGlobal("fetch", () => {
    fetchCalls++;
    throw Error("UNEXPECTED_EXTERNAL_FETCH");
  });
  // Complete synthetic raw recipe, never a provider/profile/Owner qualification.
  // All source and policy choices precede public constructor calls.
  const raw = receiptInput();
  const rawJSON = canonical(raw.attachRequest);
  const timingPolicy = {
    version: 1,
    firstDispatchedAt: 1700000001,
    periodStart: 1700000000,
    periodEnd: 1702592000,
    workEndWallMs: 1700000005000,
    endWallMs: 1700000006000,
  };
  const originalBundle = {
    original: raw.attachRequest.preparation,
    acquisition: { couponRead: null, futureRaw: ["retained", null, 1.25] },
  };
  try {
    const prepared = await prepareRenewalPriceReplacementV2(
      raw.attachRequest.preparation,
    );
    const request = await prepareRenewalScheduleAttachmentV2({
      prepared,
      apiVersion: raw.attachRequest.apiVersion,
      attachKey: raw.attachRequest.attachKey,
      firstDispatchedAt: raw.attachRequest.firstDispatchedAt,
    });
    expect(raw.actualDispatch).toEqual({
      scope: request.scope,
      apiVersion: request.apiVersion,
      method: request.method,
      path: request.path,
      payload: request.payload,
      key: request.key,
      firstDispatchedAt: request.firstDispatchedAt,
    });
    expect(prepared.expected.periodStart).toBe(timingPolicy.periodStart);
    expect(prepared.expected.periodEnd).toBe(timingPolicy.periodEnd);
    expect(request.firstDispatchedAt).toBe(timingPolicy.firstDispatchedAt);
    expect(canonical(raw.attachRequest)).toBe(rawJSON);
    const record = {
      schemaVersion: 2,
      requestBinding: request.requestIdentity.binding,
      authorization: {
        scope: "codec01-host",
        id: "codec01-consent",
        revision: 1,
      },
      logicalOperationId: "codec01-original-operation",
      stage: "attach",
      account: { mode: "platform", stripeAccount: null, livemode: false },
      apiVersion: raw.attachRequest.apiVersion,
      profile: "unqualified-offline-codec-DATA",
      attachRequest: raw.attachRequest,
      dispatch: raw.actualDispatch,
      originalBundle,
      timingPolicy,
    };
    const recordJSON = canonical(record);
    expect(recordJSON.length).toBeLessThanOrEqual(500000);
    expect(new TextEncoder().encode(recordJSON).length).toBeLessThanOrEqual(
      500000,
    );
    expect(Object.prototype.hasOwnProperty.call(record, "basis")).toBe(false);
    expect(originalBundle).not.toEqual(raw.attachRequest.preparation);
    // Existing actual synchronous export is the target; no absent API/type seam.
    const normalized = canonicalJournalRecord(recordJSON);
    expect(normalized).toEqual({
      json: recordJSON,
      authorizationScope: "codec01-host",
      authorizationId: "codec01-consent",
      authorizationRevision: 1,
      logicalOperationId: "codec01-original-operation",
      requestBinding: request.requestIdentity.binding,
      recordVersion: 2,
    });
    const retained = JSON.parse(normalized.json);
    expect(retained).toEqual(JSON.parse(recordJSON));
    expect(Object.prototype.hasOwnProperty.call(retained, "basis")).toBe(false);
    expect(retained.originalBundle.acquisition).toEqual(
      originalBundle.acquisition,
    );
    expect(
      Object.prototype.hasOwnProperty.call(
        retained.originalBundle.acquisition,
        "couponRead",
      ),
    ).toBe(true);
    expect(canonical(raw.attachRequest)).toBe(rawJSON);
    return {
      record,
      normalized,
      recordJSON,
      request,
      fetchCalls: () => fetchCalls,
    };
  } finally {
    expect(fetchCalls).toBe(0);
  }
}

export const create = makeFunctionReference<"mutation">(
  "renewalOperations/mutations:createAuthorizedOperation",
);
export const load = makeFunctionReference<"query">(
  "renewalOperations/queries:loadAuthorizedOperation",
);
export const VALUE_LIMIT = 1048576;

export function componentFixture() {
  const t = convexTest(schema, modules);
  async function physical() {
    const [operations, attempts, events, payloads] = await Promise.all([
      t.run((ctx) => ctx.db.query("renewalOperations").take(3)),
      t.run((ctx) => ctx.db.query("renewalOperationAttempts").take(3)),
      t.run((ctx) => ctx.db.query("renewalOperationEvents").take(4)),
      t.run((ctx) => ctx.db.query("renewalOperationPayloads").take(5)),
    ]);
    return { operations, attempts, events, payloads };
  }
  return { t, physical };
}

export async function expectInvalidCreate(
  h: Awaited<ReturnType<typeof codecFixture>>,
  recordJSON: string,
  label: string,
) {
  const { t, physical } = componentFixture();
  const args = {
    authorizationScope: h.record.authorization.scope,
    logicalOperationId: h.record.logicalOperationId,
    authorizationRevision: h.record.authorization.revision,
    recordJSON,
  };
  expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
  const before = await physical();
  expect(before).toEqual({
    operations: [],
    attempts: [],
    events: [],
    payloads: [],
  });
  let targetFailed = false;
  try {
    await expect(t.mutation(create, args)).rejects.toThrow(
      /^RENEWAL_JOURNAL_CONFLICT$/,
    );
  } catch (error) {
    targetFailed = true;
    throw error;
  } finally {
    try {
      const after = await physical();
      console.info(
        `${label}_SETTLEMENT`,
        JSON.stringify({
          physicalEqual: JSON.stringify(after) === JSON.stringify(before),
          rows: Object.fromEntries(
            Object.entries(after).map(([key, rows]) => [key, rows.length]),
          ),
          fetchCalls: h.fetchCalls(),
        }),
      );
      expect(after).toEqual(before);
      expect(h.fetchCalls()).toBe(0);
    } catch (inspectionError) {
      if (!targetFailed) throw inspectionError;
      console.info(`${label}_READONLY_INSPECTION_FAILED`);
    }
  }
}
