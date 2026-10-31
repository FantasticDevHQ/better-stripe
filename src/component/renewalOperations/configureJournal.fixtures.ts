import { expect, vi } from "vitest";
import assert from "node:assert/strict";
import { makeConfigureReadNativeBaseline } from "../../client/billing/renewalAttach/internal/test-fixtures/configureReadNativeBaseline.js";
import {
  prepareRenewalPriceReplacementV2 as c1,
  prepareRenewalScheduleAttachmentV2 as c2,
  constructRenewalScheduleAttachmentReceiptV2 as c3,
  projectRenewalConfigurationV2 as c6,
} from "../../client/billing/renewalV2/index.js";
import { renewalSnapshot } from "../../client/billing/renewalReplacementSnapshot.js";

export const canonicalConfigure = (value: unknown) =>
  JSON.stringify(renewalSnapshot(value));
export function sevenConfigure(request: {
  scope: "platform";
  apiVersion: string;
  method: "POST";
  path: string;
  payload: unknown;
  key: string;
  firstDispatchedAt: number;
}) {
  const { scope, apiVersion, method, path, payload, key, firstDispatchedAt } =
    request;
  return { scope, apiVersion, method, path, payload, key, firstDispatchedAt };
}
/** Complete synthetic constructor DATA only, without an Owner or provider call. */
export async function configureJournalFixture(
  options: { targetInterval?: "week"; sourcePadding?: string } = {},
) {
  let fetches = 0;
  vi.stubGlobal("fetch", () => {
    fetches++;
    throw Error("UNEXPECTED_PROVIDER_CALL");
  });
  const baseline = makeConfigureReadNativeBaseline();
  if (options.sourcePadding !== undefined)
    Object.assign(baseline.original.originalBundle, {
      witnessPadding: options.sourcePadding,
    });
  if (options.targetInterval) {
    const prep = baseline.original.attachRequest.preparation;
    Object.assign(prep.targetPrice.recurring, {
      interval: options.targetInterval,
    });
    Object.assign(prep.subscription, { trial_start: null, trial_end: null });
    baseline.original.originalBundle.wireTargetPrice = structuredClone(
      prep.targetPrice,
    );
    baseline.original.originalBundle.wireSubscription = structuredClone(
      prep.subscription,
    );
  }
  const attachRequest = structuredClone(baseline.original.attachRequest);
  const prepared = await c1(attachRequest.preparation);
  const attach = await c2({
    prepared,
    apiVersion: attachRequest.apiVersion,
    attachKey: attachRequest.attachKey,
    firstDispatchedAt: attachRequest.firstDispatchedAt,
  });
  const rawReceipt: Parameters<typeof c3>[0] = {
    attachRequest,
    actualDispatch: {
      scope: attach.scope,
      apiVersion: attach.apiVersion,
      method: attach.method,
      path: attach.path,
      payload: attach.payload,
      key: attach.key,
      firstDispatchedAt: attach.firstDispatchedAt,
    },
    providerSnapshot: structuredClone(baseline.schedule),
  };
  const receipt = await c3(rawReceipt);
  const configuration = {
    preparation: attachRequest.preparation,
    attachReceipt: rawReceipt,
    freshSubscription: {
      ...structuredClone(attachRequest.preparation.subscription),
      schedule: receipt.scheduleId,
    },
    targetPrice: structuredClone(attachRequest.preparation.targetPrice),
    billingCustomer: structuredClone(attachRequest.preparation.billingCustomer),
    schedule: structuredClone(baseline.schedule),
    apiVersion: attachRequest.apiVersion,
    observedAt: baseline.clockPlan.observationSeconds,
    firstDispatchedAt: baseline.clockPlan.observationSeconds,
    configureKey: "configure:journal:retained-key",
  };
  const request = await c6(configuration);
  assert("requestIdentity" in request);
  const parentAttachment = {
    operationId: "synthetic-parent-operation-DATA",
    attemptId: "synthetic-parent-attempt-DATA",
    sourcePayloadId: "synthetic-parent-source-DATA",
    receiptBinding: receipt.binding,
  };
  const record = {
    schemaVersion: 2,
    authorization: {
      scope: "configure-host",
      id: "configure-consent",
      revision: 1,
    },
    logicalOperationId: "configure-stage-operation",
    requestBinding: request.requestIdentity.binding,
    stage: "configure",
    account: {
      mode: "platform",
      stripeAccount: null,
      livemode: prepared.expected.livemode,
    },
    apiVersion: request.apiVersion,
    dispatch: sevenConfigure(request),
    parentAttachment,
    configureRecord: {
      configuration,
      request,
      attachReceipt: receipt,
      originalBundle: structuredClone(baseline.original.originalBundle),
    },
    timingPolicy: {
      version: 1,
      firstDispatchedAt: request.firstDispatchedAt,
      periodStart: prepared.expected.periodStart,
      periodEnd: prepared.expected.periodEnd,
      workEndWallMs:
        (baseline.clockPlan.attachSeconds + baseline.clockPlan.workSeconds) *
        1000,
      endWallMs:
        (baseline.clockPlan.attachSeconds + baseline.clockPlan.endSeconds) *
        1000,
    },
  };
  expect(request.key).not.toBe(attach.key);
  expect(fetches).toBe(0);
  return {
    record,
    request,
    receipt,
    attachRequest,
    rawReceipt,
    fetches: () => fetches,
  };
}

export async function configureComponentFixture(
  publishParent = true,
  options: { targetInterval?: "week"; sourcePadding?: string } = {},
) {
  const h = await configureJournalFixture(options);
  const { convexTest } = await import("convex-test");
  const { schema, modules } = await import("../../test.js");
  const { makeFunctionReference } = await import("convex/server");
  const { canonicalJournalEvent } =
    await import("../../shared/renewalOperationJournal.js");
  const t = convexTest(schema, modules);
  const create = makeFunctionReference<"mutation">(
    "renewalOperations/mutations:createAuthorizedOperation",
  );
  const reserve = makeFunctionReference<"mutation">(
    "renewalOperations/mutations:reserveAttempt",
  );
  const bind = makeFunctionReference<"mutation">(
    "renewalOperations/mutations:bindInitialBasis",
  );
  const append = makeFunctionReference<"mutation">(
    "renewalOperations/mutations:appendStageEvent",
  );
  const retain = makeFunctionReference<"mutation">(
    "renewalOperations/mutations:retainProviderAcknowledgement",
  );
  const load = makeFunctionReference<"query">(
    "renewalOperations/queries:loadAuthorizedOperation",
  );
  const parentPolicy = {
    ...h.record.timingPolicy,
    firstDispatchedAt: h.attachRequest.firstDispatchedAt,
  };
  const parentRecord = {
    schemaVersion: 2,
    authorization: { ...h.record.authorization, id: "attach-parent-consent" },
    logicalOperationId: "attach-stage-parent",
    stage: "attach",
    account: h.record.account,
    apiVersion: h.record.apiVersion,
    requestBinding: h.receipt.request.requestIdentity.binding,
    attachRequest: h.attachRequest,
    originalBundle: h.record.configureRecord.originalBundle,
    dispatch: h.rawReceipt.actualDispatch,
    timingPolicy: parentPolicy,
  };
  const parentJSON = canonicalConfigure(parentRecord);
  const parentCreated = await t.mutation(create, {
    authorizationScope: parentRecord.authorization.scope,
    authorizationRevision: 1,
    logicalOperationId: parentRecord.logicalOperationId,
    recordJSON: parentJSON,
  });
  expect(parentCreated.status).toBe("created");
  const acquired = await t.mutation(reserve, {
    operationId: parentCreated.operationId,
    expectedRevision: 0,
    stage: "attach",
    expectedRequestBinding: parentRecord.requestBinding,
    recordJSON: parentJSON,
  });
  expect(acquired.disposition).toBe("acquired");
  const basis = {
    startWallMs: parentPolicy.firstDispatchedAt * 1000,
    startNsDecimal: "1000000000",
    workEndWallMs: parentPolicy.workEndWallMs,
    workEndNsDecimal: String(
      1000000000n +
        BigInt(
          parentPolicy.workEndWallMs - parentPolicy.firstDispatchedAt * 1000,
        ) *
          1000000n,
    ),
    endWallMs: parentPolicy.endWallMs,
    endNsDecimal: String(
      1000000000n +
        BigInt(parentPolicy.endWallMs - parentPolicy.firstDispatchedAt * 1000) *
          1000000n,
    ),
  };
  const bound = await t.mutation(bind, {
    operationId: parentCreated.operationId,
    attemptId: acquired.reservation.attemptId,
    policyJSON: canonicalConfigure(parentPolicy),
    basisJSON: canonicalConfigure(basis),
  });
  expect(bound.status).toBe("bound");
  const parentEvents = [
    { event: "dispatch", stage: "attach", request: h.receipt.request },
    {
      event: "response",
      stage: "attach",
      request: h.receipt.request,
      body: h.rawReceipt.providerSnapshot,
      status: 200,
    },
    {
      event: "receipt",
      stage: "attach",
      request: h.receipt.request,
      receipt: h.receipt,
    },
  ];
  for (let index = 0; index < (publishParent ? 3 : 2); index++) {
    if (index === 2)
      await t.mutation(retain, {
        operationId: parentCreated.operationId,
        attemptId: acquired.reservation.attemptId,
        expectedSequence: 2,
        receiptJSON: canonicalConfigure(h.receipt),
      });
    const event = await canonicalJournalEvent(
      index + 1,
      canonicalConfigure(parentEvents[index]),
    );
    await t.mutation(append, {
      reservation: acquired.reservation,
      expectedSequence: index,
      event: {
        sequence: index + 1,
        binding: event.binding,
        dataJSON: event.json,
      },
    });
  }
  if (!publishParent)
    await t.mutation(retain, {
      operationId: parentCreated.operationId,
      attemptId: acquired.reservation.attemptId,
      expectedSequence: 2,
      receiptJSON: canonicalConfigure(h.receipt),
    });
  const record = {
    ...h.record,
    parentAttachment: {
      operationId: parentCreated.operationId,
      attemptId: acquired.reservation.attemptId,
      sourcePayloadId: acquired.reservation.payloadId,
      receiptBinding: h.receipt.binding,
    },
  };
  const createArgs = {
    authorizationScope: record.authorization.scope,
    authorizationRevision: record.authorization.revision,
    logicalOperationId: record.logicalOperationId,
    recordJSON: canonicalConfigure(record),
  };
  return {
    ...h,
    record,
    t,
    create,
    reserve,
    bind,
    append,
    retain,
    load,
    parentCreated,
    acquired,
    basis,
    createArgs,
  };
}

export async function configureAcknowledgementFixture(
  defaults: "absent" | "null" | "object" = "absent",
  responseExtras: Record<string, unknown> = {},
) {
  const h = await configureComponentFixture();
  const { constructRenewalConfigurationReceiptV2 } =
    await import("../../client/billing/renewalV2/index.js");
  const { canonicalJournalEvent } =
    await import("../../shared/renewalOperationJournal.js");
  const { makeFunctionReference } = await import("convex/server");
  const created = await h.t.mutation(h.create, h.createArgs);
  expect(created.status).toBe("created");
  const acquired = await h.t.mutation(h.reserve, {
    operationId: created.operationId,
    expectedRevision: 0,
    stage: "configure",
    expectedRequestBinding: h.request.requestIdentity.binding,
    recordJSON: h.createArgs.recordJSON,
  });
  expect(acquired.disposition).toBe("acquired");
  await h.t.mutation(h.bind, {
    operationId: created.operationId,
    attemptId: acquired.reservation.attemptId,
    policyJSON: canonicalConfigure(h.record.timingPolicy),
    basisJSON: canonicalConfigure(h.basis),
  });
  const response = structuredClone(h.rawReceipt.providerSnapshot);
  if (defaults === "absent") delete response.default_settings;
  if (defaults === "null") response.default_settings = null;
  response.futureResponse = { retained: [null, "complete", 1.25] };
  Object.assign(response, responseExtras);
  const transport = { status: 200, requestId: "req_configure_journal_DATA" };
  const request = h.request;
  const receipt = await constructRenewalConfigurationReceiptV2({
    configuration: h.record.configureRecord.configuration,
    actualDispatch: {
      scope: request.scope,
      apiVersion: request.apiVersion,
      method: request.method,
      path: request.path,
      payload: request.payload,
      key: request.key,
      firstDispatchedAt: request.firstDispatchedAt,
    },
    providerSnapshot: response,
    transport,
  });
  const events = [
    { event: "dispatch", stage: "configure", request },
    {
      event: "response",
      stage: "configure",
      request,
      body: response,
      transport,
    },
  ];
  for (const [index, data] of events.entries()) {
    const event = await canonicalJournalEvent(
      index + 1,
      canonicalConfigure(data),
    );
    await h.t.mutation(h.append, {
      reservation: acquired.reservation,
      expectedSequence: index,
      event: {
        sequence: index + 1,
        binding: event.binding,
        dataJSON: event.json,
      },
    });
  }
  const retainArgs = {
    operationId: created.operationId,
    attemptId: acquired.reservation.attemptId,
    expectedSequence: 2,
    receiptJSON: canonicalConfigure(receipt),
  };
  const readAcknowledgement = makeFunctionReference<"query">(
    "renewalOperations/queries:readProviderAcknowledgement",
  );
  const readAttempt = makeFunctionReference<"query">(
    "renewalOperations/queries:readAttempt",
  );
  return {
    ...h,
    created,
    acquired,
    response,
    transport,
    receipt,
    retainArgs,
    readAcknowledgement,
    readAttempt,
  };
}
