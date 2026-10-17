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
it.each([
  { paymentIntentId: undefined },
  { paymentIntentId: "pi_foreign" },
  { sourceChargeId: "ch_foreign" },
  { currency: "eur" },
  { transfers: [] },
  { transfers: [payment.splitRecipients[1]!] },
  {
    transfers: [
      ...payment.splitRecipients,
      {
        destinationAccountId: "acct_second_store",
        role: "store" as const,
        amount: 0,
      },
    ],
  },
  {
    transfers: [
      ...payment.splitRecipients,
      {
        destinationAccountId: scope.accountId,
        role: "affiliate" as const,
        amount: 0,
      },
    ],
  },
  {
    transfers: [
      { ...payment.splitRecipients[0]!, destinationAccountId: "malformed" },
    ],
  },
  { transfers: [{ ...payment.splitRecipients[0]!, amount: 0.5 }] },
  { transfers: [{ ...payment.splitRecipients[0]!, amount: -1 }] },
])(
  "holds malformed, missing or contradictory immutable allocation %#",
  async (patch) => {
    const t = convexTest(schema, modules);
    await t.mutation(api.connect.mutations.upsertPayment, payment);
    await t.mutation(api.connect.mutations.upsertRefund, refund);
    await t.run((ctx) =>
      ctx.db.insert("settlementAllocations", { ...allocation, ...patch }),
    );
    expect(await t.query(read, scope)).toMatchObject({
      status: "unavailable",
      reason: "scope_mismatch",
    });
  },
);
it("rejects duplicate exact-charge allocations before selecting any original store", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.connect.mutations.upsertRefund, refund);
  await t.run(async (ctx) => {
    await ctx.db.insert("settlementAllocations", allocation);
    await ctx.db.insert("settlementAllocations", {
      ...allocation,
      transfers: [
        {
          destinationAccountId: "acct_other_store",
          role: "store",
          amount: 1000,
        },
      ],
    });
  });
  expect(await t.query(read, scope)).toMatchObject({ status: "unavailable" });
});
it.each(["stripePaymentIntentId", "stripeChargeId", "currency"] as const)(
  "never qualifies foreign receipt %s",
  async (field) => {
    const t = convexTest(schema, modules);
    await t.mutation(
      api.settlement.mutations.reserveSettlementAllocation,
      allocation,
    );
    await t.mutation(api.connect.mutations.upsertRefund, {
      ...refund,
      [field]: field === "currency" ? "eur" : "foreign",
    });
    expect(await t.query(read, scope)).toMatchObject({
      status: "unavailable",
      reason: "scope_mismatch",
    });
  },
);
