import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.*s");
const payment = {
  stripePaymentIntentId: "pi_sale",
  userId: "customer",
  amount: 10000,
  currency: "usd",
  status: "succeeded" as const,
  destinationAccountId: "acct_store",
  chargeType: "separate" as const,
};
const refund = {
  stripeRefundId: "re_sale",
  stripePaymentIntentId: "pi_sale",
  amount: 1000,
  currency: "usd",
  status: "succeeded" as const,
};
const dispute = {
  stripeDisputeId: "dp_sale",
  stripePaymentIntentId: "pi_sale",
  amount: 10000,
  currency: "usd",
  status: "needs_response" as const,
  reason: "product_not_received",
  isChargeRefundable: false,
};
it("attributes refunds and disputes to the seller instead of the purchasing customer", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.connect.mutations.upsertPayment, payment);
  await t.mutation(api.connect.mutations.upsertRefund, refund);
  await t.mutation(api.connect.mutations.upsertDispute, dispute);
  expect(
    await t.query(api.connect.queries.listRefunds, { accountId: "acct_store" }),
  ).toHaveLength(1);
  expect(
    await t.query(api.connect.queries.listDisputes, {
      accountId: "acct_store",
    }),
  ).toHaveLength(1);
  expect(
    await t.query(api.connect.queries.listRefunds, { accountId: "acct_other" }),
  ).toHaveLength(0);
});
it("reconciles cases delivered before the seller's settlement metadata", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.connect.mutations.upsertRefund, refund);
  await t.mutation(api.connect.mutations.upsertDispute, dispute);
  await t.mutation(api.connect.mutations.upsertPayment, payment);
  expect(
    await t.query(api.connect.queries.listRefunds, { accountId: "acct_store" }),
  ).toHaveLength(1);
  expect(
    await t.query(api.connect.queries.listDisputes, {
      accountId: "acct_store",
    }),
  ).toHaveLength(1);
});
