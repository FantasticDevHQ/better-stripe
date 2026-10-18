import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";
import { schema, modules } from "../../test.js";
import {
  request,
  nativeSubscription,
} from "../../client/usage/subscription.fixtures.js";
const ref = (name: string) =>
  makeFunctionReference<"mutation">(`usageCredits/mutations:${name}`);
const prepare = makeFunctionReference<"mutation">(
  "usageSubscriptions/mutations:prepare",
);
const save = makeFunctionReference<"mutation">(
  "usageSubscriptions/mutations:save",
);
const record = makeFunctionReference<"mutation">("usage/mutations:record");
const balance = makeFunctionReference<"query">("usageCredits/queries:balance");
export async function setupCredits() {
  vi.useFakeTimers();
  vi.setSystemTime(700000);
  const t = convexTest(schema, modules);
  const meter = {
    scope: request.meters[0].scope,
    binding: {
      ...request.meters[0].binding,
      plan: {
        key: "calls",
        version: "v1",
        model: "prepaid",
        unit: { name: "call", precision: 0 },
        rate: { currency: "usd", unitAmountDecimal: "2" },
        insufficientBalance: "reject",
      } as const,
    },
  };
  const terms = { ...request, meters: [meter] };
  const intent = await t.mutation(prepare, {
    termsJson: JSON.stringify(terms),
    method: "direct",
  });
  await t.mutation(save, {
    key: intent.key,
    nativeJson: JSON.stringify(nativeSubscription()),
    startedAt: Date.now(),
  });
  const purchase = {
    ...meter,
    purchaseId: "topup1",
    quantity: "10",
    ownership: "issuer",
    rollover: "retain_original_terms",
  };
  const row = await t.mutation(ref("preparePurchase"), {
    inputJson: JSON.stringify(purchase),
  });
  await t.mutation(ref("pinPayment"), {
    key: row.key,
    paymentIntentId: "pi_topup1",
  });
  const proof = {
    paymentIntentId: "pi_topup1",
    chargeId: "ch_topup1",
    amount: 20,
    currency: "usd",
    customerAccount: "acct_buyer",
    livemode: false,
  };
  await t.mutation(ref("verifyPayment"), {
    key: row.key,
    proofJson: JSON.stringify(proof),
  });
  await t.mutation(ref("pinGrant"), {
    key: row.key,
    proofJson: JSON.stringify({
      ...proof,
      creditGrantId: "credgr_topup1",
      stripePriceId: "price_calls",
      createdAt: 700,
      effectiveAt: 700,
      expiresAt: null,
    }),
  });
  const subscription = {
    subscriptionId: "sub_calls",
    subscriptionItemId: "si_calls",
    stripePriceId: "price_calls",
    period: { start: 600, end: 1200 },
    interval: "month",
  };
  const event = {
    ...meter,
    sourceEventId: "work1",
    quantity: "6",
    occurredAt: 700,
  };
  return { t, meter, purchase, row, proof, subscription, event };
}
afterEach(() => vi.useRealTimers());
it("atomically reserves payment-backed units, commits with ledger acceptance and rejects concurrent overspend", async () => {
  const { t, meter, event, subscription } = await setupCredits();
  const args = {
    inputJson: JSON.stringify(event),
    subscriptionJson: JSON.stringify(subscription),
  };
  const first = await t.mutation(ref("reserve"), args);
  expect(await t.mutation(ref("reserve"), args)).toEqual(first);
  await expect(
    t.mutation(ref("reserve"), {
      ...args,
      inputJson: JSON.stringify({ ...event, sourceEventId: "work2" }),
    }),
  ).rejects.toThrow(/insufficient/i);
  expect(
    await t.query(balance, { bindingJson: JSON.stringify(meter) }),
  ).toMatchObject({
    availableQuantity: "4",
    reservedQuantity: "6",
    consumedQuantity: "0",
  });
  const receipt = await t.mutation(record, {
    ...args,
    reservationId: first.reservationId,
  });
  expect(
    await t.mutation(record, { ...args, reservationId: first.reservationId }),
  ).toEqual(receipt);
  expect(
    await t.query(balance, { bindingJson: JSON.stringify(meter) }),
  ).toMatchObject({
    availableQuantity: "4",
    reservedQuantity: "0",
    consumedQuantity: "6",
    cashCollection: "none",
  });
  await expect(
    t.mutation(ref("release"), {
      scope: meter.scope,
      reservationId: first.reservationId,
      reason: "work_failed",
    }),
  ).rejects.toThrow(/committed/i);
});
it("releases only uncommitted work and rejects changed reservation provenance", async () => {
  const { t, meter, event, subscription } = await setupCredits();
  const args = {
    inputJson: JSON.stringify(event),
    subscriptionJson: JSON.stringify(subscription),
  };
  const first = await t.mutation(ref("reserve"), args);
  await expect(
    t.mutation(record, {
      ...args,
      inputJson: JSON.stringify({ ...event, occurredAt: 701 }),
      reservationId: first.reservationId,
    }),
  ).rejects.toThrow(/reservation/i);
  await expect(
    t.mutation(ref("reserve"), {
      ...args,
      inputJson: JSON.stringify({ ...event, quantity: "5" }),
    }),
  ).rejects.toThrow(/conflict/i);
  await t.mutation(ref("release"), {
    scope: meter.scope,
    reservationId: first.reservationId,
    reason: "abandoned_before_work",
  });
  await t.mutation(ref("release"), {
    scope: meter.scope,
    reservationId: first.reservationId,
    reason: "abandoned_before_work",
  });
  expect(
    await t.query(balance, { bindingJson: JSON.stringify(meter) }),
  ).toMatchObject({ availableQuantity: "10", reservedQuantity: "0" });
  expect((await t.mutation(ref("reserve"), args)).state).toBe("released");
});
it("never accepts unpaid grants, reuses original purchase identities and prevents duplicate payment backing", async () => {
  const { t, purchase, row, proof } = await setupCredits();
  expect(
    (
      await t.mutation(ref("preparePurchase"), {
        inputJson: JSON.stringify(purchase),
      })
    ).key,
  ).toBe(row.key);
  await expect(
    t.mutation(ref("preparePurchase"), {
      inputJson: JSON.stringify({ ...purchase, quantity: "11" }),
    }),
  ).rejects.toThrow(/conflict/i);
  const other = await t.mutation(ref("preparePurchase"), {
    inputJson: JSON.stringify({ ...purchase, purchaseId: "topup2" }),
  });
  await expect(
    t.mutation(ref("pinGrant"), {
      key: other.key,
      proofJson: JSON.stringify({
        ...proof,
        creditGrantId: "credgr_other",
        stripePriceId: "price_calls",
        createdAt: 700,
        effectiveAt: 700,
        expiresAt: null,
      }),
    }),
  ).rejects.toThrow(/payment/i);
  await expect(
    t.mutation(ref("pinPayment"), {
      key: other.key,
      paymentIntentId: "pi_topup1",
    }),
  ).rejects.toThrow(/payment/i);
});

it("holds consumption after refund/dispute evidence without releasing committed or reserved backing", async () => {
  const { t, meter, event, subscription, row } = await setupCredits();
  const args = {
    inputJson: JSON.stringify(event),
    subscriptionJson: JSON.stringify(subscription),
  };
  const reservation = await t.mutation(ref("reserve"), args);
  await t.mutation(ref("freezePurchase"), {
    key: row.key,
    paymentIntentId: "pi_topup1",
    reason: "payment_refunded",
  });
  await expect(
    t.mutation(record, { ...args, reservationId: reservation.reservationId }),
  ).rejects.toThrow(/reconciliation|backing/i);
  expect(
    await t.query(balance, { bindingJson: JSON.stringify(meter) }),
  ).toMatchObject({
    status: "held",
    availableQuantity: "0",
    reservedQuantity: "6",
    consumedQuantity: "0",
  });
  expect(
    await t.run((ctx) => ctx.db.query("usageEvents").collect()),
  ).toHaveLength(0);
});
it("cannot spend the same last units from two concurrent work requests", async () => {
  const { t, meter, event, subscription } = await setupCredits();
  const results = await Promise.allSettled(
    ["left", "right"].map((sourceEventId) =>
      t.mutation(ref("reserve"), {
        inputJson: JSON.stringify({ ...event, sourceEventId }),
        subscriptionJson: JSON.stringify(subscription),
      }),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    await t.query(balance, { bindingJson: JSON.stringify(meter) }),
  ).toMatchObject({ availableQuantity: "4", reservedQuantity: "6" });
});

it("retains expired units as provenance and closes only fully reconciled credit accounts", async () => {
  const { t, meter, purchase } = await setupCredits();
  await expect(
    t.mutation(ref("closeAccount"), { bindingJson: JSON.stringify(meter) }),
  ).rejects.toThrow(/reconcil|credit/i);
  await t.mutation(ref("saveObservation"), {
    inputJson: JSON.stringify(purchase),
    startedAt: Date.now(),
    proofJson: JSON.stringify({
      creditGrantId: "credgr_topup1",
      paymentIntentId: "pi_topup1",
      currency: "usd",
      ledgerAmount: 0,
      availableAmount: 0,
      granted: 20,
      applied: 0,
      expired: 20,
      voided: 0,
      reinstated: 0,
      invoicesVerified: true,
      complete: true,
      transactions: [
        {
          id: "cbtxn_expire",
          kind: "credits_expired",
          amount: 20,
          invoiceId: null,
          invoiceLineId: null,
        },
      ],
    }),
  });
  expect(
    await t.query(balance, { bindingJson: JSON.stringify(meter) }),
  ).toMatchObject({ availableQuantity: "0", expiredQuantity: "10" });
  await expect(
    t.mutation(ref("closeAccount"), { bindingJson: JSON.stringify(meter) }),
  ).rejects.toThrow(/refund/i);
  await t.mutation(ref("freezePurchase"), {
    key: (
      await t.mutation(ref("preparePurchase"), {
        inputJson: JSON.stringify(purchase),
      })
    ).key,
    paymentIntentId: "pi_topup1",
    reason: "payment_refunded",
    refundedAmount: 20,
  });
  await t.mutation(ref("closeAccount"), { bindingJson: JSON.stringify(meter) });
  await expect(
    t.mutation(ref("preparePurchase"), {
      inputJson: JSON.stringify({ ...purchase, purchaseId: "afterclose" }),
    }),
  ).rejects.toThrow(/reconciliation|closed/i);
});

it("counts locally consumed but unfinalized native grants before accepting another purchase", async () => {
  const { t, purchase } = await setupCredits();
  await t.run(async (ctx) => {
    const grant = (await ctx.db.query("usageCreditGrants").first())!;
    const { _id, _creationTime, ...fields } = grant;
    await ctx.db.patch("usageCreditGrants", _id, {
      available: "0",
      reserved: "0",
      consumed: "10",
    });
    for (let index = 1; index < 100; index++)
      await ctx.db.insert("usageCreditGrants", {
        ...fields,
        purchaseKey: "capacity" + index,
        creditGrantId: "credgr_capacity" + index,
        available: "0",
        reserved: "0",
        consumed: "10",
      });
  });
  await expect(
    t.mutation(ref("preparePurchase"), {
      inputJson: JSON.stringify({ ...purchase, purchaseId: "over-native-cap" }),
    }),
  ).rejects.toThrow(/capacity|quota/i);
});

it("allocates by provider creation time when native grants are mirrored out of order", async () => {
  const { t, purchase, event, subscription } = await setupCredits();
  const row = await t.mutation(ref("preparePurchase"), {
    inputJson: JSON.stringify({ ...purchase, purchaseId: "older-native" }),
  });
  const proof = {
    paymentIntentId: "pi_older",
    chargeId: "ch_older",
    amount: 20,
    currency: "usd",
    customerAccount: "acct_buyer",
    livemode: false,
  };
  await t.mutation(ref("pinPayment"), {
    key: row.key,
    paymentIntentId: proof.paymentIntentId,
  });
  await t.mutation(ref("verifyPayment"), {
    key: row.key,
    proofJson: JSON.stringify(proof),
  });
  await t.mutation(ref("pinGrant"), {
    key: row.key,
    proofJson: JSON.stringify({
      ...proof,
      creditGrantId: "credgr_older",
      stripePriceId: "price_calls",
      createdAt: 690,
      effectiveAt: 700,
      expiresAt: null,
    }),
  });
  const reservation = await t.mutation(ref("reserve"), {
    inputJson: JSON.stringify(event),
    subscriptionJson: JSON.stringify(subscription),
  });
  const grants = await t.run((ctx) =>
    ctx.db.query("usageCreditGrants").take(10),
  );
  expect(grants.find((g) => g.creditGrantId === "credgr_older")?.reserved).toBe(
    "6",
  );
  expect(
    grants.find((g) => g.creditGrantId === "credgr_topup1")?.reserved,
  ).toBe("0");
  expect(reservation.state).toBe("reserved");
});
