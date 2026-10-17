import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api } from "../_generated/api.js";
import { schema, modules } from "../../test.js";

const scope = {
  commandKey: "dojo-refund:original_store_gap:v1",
  accountId: "acct_original_store",
  stripePaymentIntentId: "pi_original_split",
  stripeChargeId: "ch_original_split",
  currency: "usd",
};
const refund = {
  stripeRefundId: "re_original_split",
  stripePaymentIntentId: scope.stripePaymentIntentId,
  stripeChargeId: scope.stripeChargeId,
  amount: 50,
  currency: "usd",
  status: "pending" as const,
  metadata: { betterStripeRefundCommand: scope.commandKey },
};
const payment = {
  stripePaymentIntentId: scope.stripePaymentIntentId,
  userId: "original_buyer",
  accountId: "acct_original_buyer",
  amount: 1000,
  currency: "usd",
  status: "succeeded" as const,
  chargeType: "separate" as const,
  splitRecipients: [
    {
      destinationAccountId: scope.accountId,
      role: "store" as const,
      amount: 700,
    },
    {
      destinationAccountId: "acct_affiliate",
      role: "affiliate" as const,
      amount: 300,
    },
  ],
};
const read = api.refundHistory.queries.getRefundCommandEvidence;

const allocation = {
  sourceChargeId: scope.stripeChargeId,
  paymentIntentId: scope.stripePaymentIntentId,
  currency: scope.currency,
  gross: 1000,
  processingFee: 0,
  platformNet: 0,
  transfers: payment.splitRecipients,
};
it.each([false, true])(
  "qualifies immutable original separate store, refund first=%s, without rewriting history",
  async (isRefundFirst) => {
    const t = convexTest(schema, modules);
    if (isRefundFirst)
      await t.mutation(api.connect.mutations.upsertRefund, refund);
    await t.mutation(api.connect.mutations.upsertPayment, payment);
    await t.mutation(
      api.settlement.mutations.reserveSettlementAllocation,
      allocation,
    );
    if (!isRefundFirst)
      await t.mutation(api.connect.mutations.upsertRefund, refund);
    const before = await t.run((ctx) => ctx.db.query("refunds").take(2));
    expect(await t.query(read, scope)).toMatchObject({
      status: "observed",
      refund: { ...refund, accountId: scope.accountId },
    });
    expect(await t.run((ctx) => ctx.db.query("refunds").take(2))).toEqual(
      before,
    );
    expect(before[0]?.accountId).toBeUndefined();
  },
);
it("keeps original allocation authority after normal SAME-PI store reassignment and reserve replay", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.connect.mutations.upsertPayment, payment);
  const original = await t.mutation(
    api.settlement.mutations.reserveSettlementAllocation,
    allocation,
  );
  await t.mutation(api.connect.mutations.upsertRefund, refund);
  const changed = [
    {
      destinationAccountId: "acct_replacement",
      role: "store" as const,
      amount: 700,
    },
    payment.splitRecipients[1]!,
  ];
  await t.mutation(api.connect.mutations.upsertPayment, {
    ...payment,
    splitRecipients: changed,
  });
  expect(
    await t.mutation(api.settlement.mutations.reserveSettlementAllocation, {
      ...allocation,
      transfers: changed,
    }),
  ).toEqual(original);
  expect(await t.query(read, scope)).toMatchObject({
    status: "observed",
    refund: { accountId: scope.accountId },
  });
  expect(
    await t.query(read, { ...scope, accountId: "acct_replacement" }),
  ).toMatchObject({ status: "unavailable" });
  expect(
    await t.query(read, { ...scope, accountId: "acct_affiliate" }),
  ).toMatchObject({ status: "unavailable" });
});
it.each([false, true])(
  "holds payment-only ownerless legacy provenance, destination=%s",
  async (isDestination) => {
    const t = convexTest(schema, modules);
    await t.mutation(api.connect.mutations.upsertRefund, refund);
    // Late raw history has no immutable capture allocation and no receipt owner.
    await t.run((ctx) =>
      ctx.db.insert(
        "payments",
        isDestination
          ? {
              ...payment,
              chargeType: "destination",
              splitRecipients: undefined,
              destinationAccountId: scope.accountId,
            }
          : payment,
      ),
    );
    expect(await t.query(read, scope)).toMatchObject({
      status: "unavailable",
      reason: "scope_mismatch",
    });
  },
);
it("retains persisted destination-account parity", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.connect.mutations.upsertPayment, {
    ...payment,
    chargeType: "destination",
    splitRecipients: [],
    destinationAccountId: scope.accountId,
  });
  await t.mutation(api.connect.mutations.upsertRefund, refund);
  expect(await t.query(read, scope)).toMatchObject({
    status: "observed",
    refund: { accountId: scope.accountId },
  });
});
it.each(["acct_foreign", ""])(
  "never hides persisted conflicting account %s",
  async (accountId) => {
    const t = convexTest(schema, modules);
    await t.mutation(
      api.settlement.mutations.reserveSettlementAllocation,
      allocation,
    );
    await t.mutation(api.connect.mutations.upsertRefund, {
      ...refund,
      accountId,
    });
    const before = await t.run((ctx) => ctx.db.query("refunds").take(1));
    expect(await t.query(read, scope)).toMatchObject({
      status: "unavailable",
      reason: "scope_mismatch",
    });
    expect(await t.run((ctx) => ctx.db.query("refunds").take(1))).toEqual(
      before,
    );
  },
);
