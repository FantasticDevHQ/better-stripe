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

it.each([false, true])(
  "qualifies original separate store, refund first=%s, without rewriting ownerless history",
  async (isRefundFirst) => {
    const t = convexTest(schema, modules);
    if (isRefundFirst)
      await t.mutation(api.connect.mutations.upsertRefund, refund);
    await t.mutation(api.connect.mutations.upsertPayment, payment);
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

it("retains destination parity", async () => {
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

it.each([
  { splitRecipients: [] },
  {
    splitRecipients: [
      ...payment.splitRecipients,
      { destinationAccountId: "acct_second_store", role: "store" as const },
    ],
  },
  {
    splitRecipients: [
      payment.splitRecipients[0]!,
      payment.splitRecipients[1]!,
      payment.splitRecipients[1]!,
    ],
  },
  {
    splitRecipients: [
      {
        ...payment.splitRecipients[0]!,
        destinationAccountId: "acct_foreign_store",
      },
    ],
  },
  { splitRecipients: [payment.splitRecipients[1]!] },
  {
    splitRecipients: [...payment.splitRecipients, payment.splitRecipients[0]!],
  },
  {
    splitRecipients: [
      { ...payment.splitRecipients[0]!, destinationAccountId: "foreign" },
    ],
  },
  { destinationAccountId: scope.accountId },
  { chargeType: "destination" as const },
  { currency: "eur" },
])("holds malformed or contradictory original routing %#", async (patch) => {
  const t = convexTest(schema, modules);
  await t.mutation(api.connect.mutations.upsertPayment, {
    ...payment,
    ...patch,
  });
  await t.mutation(api.connect.mutations.upsertRefund, refund);
  // Force ownerless history: existing ingestion is intentionally unchanged.
  await t.run(async (ctx) => {
    const row = (await ctx.db.query("refunds").take(1))[0]!;
    await ctx.db.patch("refunds", row._id, { accountId: undefined });
  });
  expect(await t.query(read, scope)).toMatchObject({ status: "unavailable" });
});

it("rejects duplicate original payment rows without selecting either", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("payments", payment);
    await ctx.db.insert("payments", { ...payment, userId: "another_buyer" });
  });
  await t.mutation(api.connect.mutations.upsertRefund, refund);
  expect(await t.query(read, scope)).toMatchObject({ status: "unavailable" });
});

it("keeps missing original payment and affiliate scope unavailable", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.connect.mutations.upsertRefund, refund);
  expect(await t.query(read, scope)).toMatchObject({ status: "unavailable" });
  await t.mutation(api.connect.mutations.upsertPayment, payment);
  expect(
    await t.query(read, { ...scope, accountId: "acct_affiliate" }),
  ).toMatchObject({ status: "unavailable" });
});

it("never hides an explicitly conflicting refund account with original routing", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.connect.mutations.upsertPayment, payment);
  await t.mutation(api.connect.mutations.upsertRefund, {
    ...refund,
    accountId: "acct_foreign",
  });
  const before = await t.run((ctx) => ctx.db.query("refunds").take(1));
  expect(await t.query(read, scope)).toMatchObject({
    status: "unavailable",
    reason: "scope_mismatch",
  });
  expect(await t.run((ctx) => ctx.db.query("refunds").take(1))).toEqual(before);
});

it("qualifies legacy ownerless destination history without changing stored history", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.connect.mutations.upsertRefund, refund);
  await t.run((ctx) =>
    ctx.db.insert("payments", {
      ...payment,
      chargeType: undefined,
      splitRecipients: undefined,
      destinationAccountId: scope.accountId,
    }),
  );
  const before = await t.run((ctx) => ctx.db.query("refunds").take(1));
  expect(await t.query(read, scope)).toMatchObject({
    status: "observed",
    refund: { accountId: scope.accountId },
  });
  expect(await t.run((ctx) => ctx.db.query("refunds").take(1))).toEqual(before);
});

it.each(["stripePaymentIntentId", "stripeChargeId", "currency"] as const)(
  "never qualifies ownerless receipt against foreign %s",
  async (field) => {
    const t = convexTest(schema, modules);
    await t.mutation(api.connect.mutations.upsertPayment, payment);
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

it("does not select a current buyer or account mapping instead of original payment routing", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.connect.mutations.upsertPayment, payment);
  await t.mutation(api.connect.mutations.upsertRefund, refund);
  await t.run((ctx) =>
    ctx.db.insert("payments", {
      ...payment,
      stripePaymentIntentId: "pi_replacement",
      accountId: "acct_replacement",
      splitRecipients: [
        { destinationAccountId: "acct_new_owner", role: "store" },
      ],
    }),
  );
  expect(await t.query(read, scope)).toMatchObject({
    status: "observed",
    refund: { accountId: scope.accountId },
  });
  expect(
    await t.query(read, { ...scope, accountId: "acct_new_owner" }),
  ).toMatchObject({ status: "unavailable" });
});
