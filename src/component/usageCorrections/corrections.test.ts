import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";
import { schema, modules } from "../../test.js";
import {
  request,
  nativeSubscription,
} from "../../client/usage/subscription.fixtures.js";
const ref = (name: string) =>
  makeFunctionReference<"mutation">(`usageCorrections/mutations:${name}`);
const record = makeFunctionReference<"mutation">("usage/mutations:record");
const read = makeFunctionReference<"query">(
  "usageCorrections/queries:readHistory",
);
async function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(700000);
  const t = convexTest(schema, modules),
    meter = request.meters[0];
  const event = {
    ...meter,
    binding: {
      ...meter.binding,
      plan: {
        key: "calls",
        version: "v1",
        model: "pay_as_you_go",
        unit: { name: "call", precision: 0 },
        rate: { currency: "usd", unitAmountDecimal: "2" },
      },
    },
    sourceEventId: "work1",
    quantity: "6",
    occurredAt: 700,
  };
  const subscription = {
    subscriptionId: "sub_calls",
    subscriptionItemId: "si_calls",
    stripePriceId: "price_calls",
    period: { start: 600, end: 1200 },
    interval: "month",
  };
  const args = {
      inputJson: JSON.stringify(event),
      subscriptionJson: JSON.stringify(subscription),
    },
    receipt = await t.mutation(record, args);
  const correction = {
    scope: event.scope,
    eventId: receipt.eventId,
    correctionId: "fix1",
    actor: "operator1",
    reason: "duplicate business activity",
    operation: "cancel",
  };
  return { t, event, subscription, args, receipt, correction };
}
afterEach(() => vi.useRealTimers());
it("cancels unsent usage once, preserves its immutable receipt and cannot be resumed into billing", async () => {
  const { t, args, receipt, correction } = await setup();
  const first = await t.mutation(ref("prepare"), {
    inputJson: JSON.stringify(correction),
  });
  expect(first).toMatchObject({
    state: "confirmed",
    reason: "canceled_before_delivery",
    cashConsequence: "none",
  });
  expect(
    await t.mutation(ref("prepare"), { inputJson: JSON.stringify(correction) }),
  ).toEqual(first);
  expect(await t.mutation(record, args)).toEqual(receipt);
  const status = await t.mutation(
    makeFunctionReference<"mutation">("usageDelivery/mutations:resume"),
    { scope: correction.scope, eventId: correction.eventId },
  );
  expect(status.state).toBe("canceled");
  expect(
    await t.mutation(
      makeFunctionReference<"mutation">("usageDelivery/steps:claim"),
      { scope: correction.scope, eventId: correction.eventId },
    ),
  ).toEqual({ kind: "done" });
  const page = await t.query(read, {
    scope: correction.scope,
    eventId: correction.eventId,
    paginationOpts: { numItems: 1, cursor: null },
  });
  expect(page.page).toHaveLength(1);
  expect(page.page[0].recordJson).toContain('"sourceEventId":"work1"');
});
it("excludes confirmed cancellation from billable estimates while retaining raw accepted quantity", async () => {
  const { t, correction } = await setup();
  await t.mutation(ref("prepare"), { inputJson: JSON.stringify(correction) });
  const result = await t.query(
    makeFunctionReference<"query">("usageObservations/queries:summary"),
    {
      scope: correction.scope,
      period: { start: 600, end: 1200 },
      maxRecords: 100,
    },
  );
  expect(JSON.parse(result).groups[0]).toMatchObject({
    acceptedQuantity: "6",
    canceledQuantity: "6",
    effectiveQuantity: "0",
    estimate: {
      status: "available",
      value: { amountDecimal: "0", currency: "usd" },
    },
  });
});
it("holds native pending cancellation and completes once with original native receipt", async () => {
  const { t, correction, receipt } = await setup();
  await t.run(async (ctx) => {
    const row = (await ctx.db.query("usageOutbox").first())!;
    await ctx.db.patch("usageOutbox", row._id, {
      state: "provider_accepted",
      attempts: 1,
      firstSendAt: 700,
      receipt: { identifier: row.providerIdentifier, created: 700 },
    });
  });
  const row = await t.mutation(ref("prepare"), {
    inputJson: JSON.stringify(correction),
  });
  expect(row.state).toBe("requested");
  const attempt = await t.mutation(ref("claim"), { key: row.key });
  const proof = {
    status: "pending",
    eventName: "calls",
    identifier: `bs_usage_${receipt.eventId}`,
    livemode: false,
    nativeAdjustmentId: null,
    creditBackingVerified: false,
  };
  const saved = await t.mutation(ref("save"), {
    key: row.key,
    attempt: attempt.attempt,
    outcomeJson: JSON.stringify(proof),
  });
  expect(saved).toMatchObject({
    state: "provider_accepted",
    restoredQuantity: "0",
    nativeStatus: "pending",
  });
  expect((await t.mutation(ref("claim"), { key: row.key })).kind).toBe("done");
});
it("keeps pending native corrections attached to the payer before account closure", async () => {
  const { t, correction } = await setup();
  await t.run(async (ctx) => {
    const row = (await ctx.db.query("usageOutbox").first())!;
    await ctx.db.patch("usageOutbox", row._id, {
      state: "provider_accepted",
      attempts: 1,
      firstSendAt: 700,
      receipt: { identifier: row.providerIdentifier, created: 700 },
    });
  });
  await t.mutation(ref("prepare"), { inputJson: JSON.stringify(correction) });
  await expect(
    t.mutation(
      makeFunctionReference<"mutation">("accountClosure/mutations:prepare"),
      { stripeAccountId: correction.scope.customerAccount },
    ),
  ).rejects.toThrow(/correction/i);
});
it("rejects new correction work after account closure starts", async () => {
  const { t, correction } = await setup();
  await t.mutation(
    makeFunctionReference<"mutation">("accountClosure/mutations:prepare"),
    { stripeAccountId: correction.scope.customerAccount },
  );
  await expect(
    t.mutation(ref("prepare"), { inputJson: JSON.stringify(correction) }),
  ).rejects.toThrow(/closure/i);
});
it("isolates guessed correction/event references and rejects changed/reassigned operation keys", async () => {
  const { t, correction, args, event } = await setup();
  await t.mutation(ref("prepare"), { inputJson: JSON.stringify(correction) });
  const foreign = { ...correction.scope, customerAccount: "acct_other" };
  await expect(
    t.query(read, {
      scope: foreign,
      eventId: correction.eventId,
      paginationOpts: { numItems: 1, cursor: null },
    }),
  ).rejects.toThrow(/scope/i);
  await expect(
    t.mutation(ref("prepare"), {
      inputJson: JSON.stringify({ ...correction, scope: foreign }),
    }),
  ).rejects.toThrow(/scope/i);
  await expect(
    t.mutation(ref("prepare"), {
      inputJson: JSON.stringify({ ...correction, actor: "differentActor" }),
    }),
  ).rejects.toThrow(/replay conflict/i);
  const second = await t.mutation(record, {
    ...args,
    inputJson: JSON.stringify({ ...event, sourceEventId: "work2" }),
  });
  await expect(
    t.mutation(ref("prepare"), {
      inputJson: JSON.stringify({ ...correction, eventId: second.eventId }),
    }),
  ).rejects.toThrow(/replay conflict/i);
});
it("lets only one competing full correction claim an event and preserves an unsupported partial request", async () => {
  const { t, correction } = await setup();
  const partial = await t.mutation(ref("prepare"), {
    inputJson: JSON.stringify({
      ...correction,
      correctionId: "partial",
      quantity: "2",
    }),
  });
  expect(partial).toMatchObject({
    state: "unsupported",
    restoredQuantity: "0",
  });
  const results = await Promise.allSettled(
    ["fixA", "fixB"].map((correctionId) =>
      t.mutation(ref("prepare"), {
        inputJson: JSON.stringify({ ...correction, correctionId }),
      }),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  const page = await t.query(read, {
    scope: correction.scope,
    eventId: correction.eventId,
    paginationOpts: { numItems: 1, cursor: null },
  });
  expect(page.isDone).toBe(false);
  expect(page.page).toHaveLength(1);
});
it("does not finalize financial adoption while a native cancellation attempt owns its lease", async () => {
  const { t, correction } = await setup();
  await t.run(async (ctx) => {
    const outbox = (await ctx.db.query("usageOutbox").first())!;
    await ctx.db.patch("usageOutbox", outbox._id, {
      state: "provider_accepted",
      attempts: 1,
      firstSendAt: 700,
      receipt: { identifier: outbox.providerIdentifier, created: 700 },
    });
  });
  const row = await t.mutation(ref("prepare"), {
    inputJson: JSON.stringify(correction),
  });
  await t.mutation(ref("claim"), { key: row.key });
  const proof = {
    creditNoteStatus: "issued",
    stripeAccountId: "acct_platform",
    livemode: false,
    customerAccount: "acct_buyer",
    stripeCustomerId: "cus_buyer",
    subscriptionId: "sub_calls",
    subscriptionItemId: "si_calls",
    stripePriceId: "price_calls",
    period: { start: 600, end: 1200 },
    creditNoteId: "cn_fix",
    invoiceId: "in_usage",
    invoiceLineId: "il_usage",
    currency: "usd",
    amount: 4,
    prePaymentAmount: 4,
    postPaymentAmount: 0,
    paymentIntentId: null,
    chargeId: null,
    refundId: null,
  };
  await expect(
    t.mutation(
      makeFunctionReference<"mutation">("usageCorrections/mutations:adopt"),
      { key: row.key, proofJson: JSON.stringify(proof) },
    ),
  ).rejects.toThrow(/active.*attempt/i);
});

it("retires corrected usage without deleting its original native validation-error history", async () => {
  const { t, event, correction } = await setup();
  const prepareEnrollment = makeFunctionReference<"mutation">(
      "usageSubscriptions/mutations:prepare",
    ),
    saveEnrollment = makeFunctionReference<"mutation">(
      "usageSubscriptions/mutations:save",
    );
  const intent = await t.mutation(prepareEnrollment, {
    termsJson: JSON.stringify({
      ...request,
      meters: [{ scope: event.scope, binding: event.binding }],
    }),
    method: "direct",
  });
  const native = nativeSubscription();
  await t.mutation(saveEnrollment, {
    key: intent.key,
    nativeJson: JSON.stringify(native),
    startedAt: Date.now(),
  });
  await t.run(async (ctx) => {
    const outbox = (await ctx.db.query("usageOutbox").first())!;
    await ctx.db.patch("usageOutbox", outbox._id, {
      state: "provider_accepted",
      attempts: 1,
      firstSendAt: 700,
      receipt: { identifier: outbox.providerIdentifier, created: 700 },
    });
    await ctx.db.insert("usageDeliveryErrors", {
      scopeKey: outbox.scopeKey,
      eventId: correction.eventId,
      code: "meter_event_invalid_value",
      providerEventId: "evt_error",
      observedAt: 700,
      dedupe: "original_error",
    });
  });
  const row = await t.mutation(ref("prepare"), {
      inputJson: JSON.stringify(correction),
    }),
    attempt = await t.mutation(ref("claim"), { key: row.key });
  await t.mutation(ref("save"), {
    key: row.key,
    attempt: attempt.attempt,
    outcomeJson: JSON.stringify({
      status: "complete",
      eventName: "calls",
      identifier: `bs_usage_${correction.eventId}`,
      livemode: false,
      nativeAdjustmentId: null,
      creditBackingVerified: false,
      billingSafe: true,
    }),
  });
  vi.setSystemTime(1400000);
  native.status = "canceled";
  await t.mutation(saveEnrollment, {
    key: intent.key,
    nativeJson: JSON.stringify(native),
    startedAt: Date.now(),
  });
  await t.mutation(
    makeFunctionReference<"mutation">("usageSubscriptions/mutations:retire"),
    {
      key: intent.key,
      proofJson: JSON.stringify({
        invoiceId: "in_closeout",
        stripeAccountId: "acct_platform",
        customerAccount: "acct_buyer",
        stripeCustomerId: "cus_buyer",
        livemode: false,
        subscriptionId: "sub_calls",
        status: "open",
        finalizedAt: 1300,
        billingReason: "subscription_cycle",
        periodEnd: 1200,
      }),
    },
  );
  expect(
    await t.run((ctx) => ctx.db.query("usageDeliveryErrors").take(10)),
  ).toHaveLength(1);
});
