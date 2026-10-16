import { modules } from "../../../test";
// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import componentSchema from "../../../../dist/component/schema.js";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
const preview = vi.hoisted(() => vi.fn());
vi.mock("../../stripe/helpers", async () => {
  const { CostRecoveryClient } =
    await import("../../../../src/client/costRecovery");
  const { components } = await import("../../_generated/api");
  return {
    stripe: {
      getUpcomingInvoicePreview: preview,
      costRecovery: new CostRecoveryClient(components.betterStripe),
    },
  };
});
it("itemizes outstanding costs and credits without adding already-invoiced costs twice", async () => {
  const t = convexTest(schema, modules);
  t.registerComponent(
    "betterStripe",
    componentSchema,
    import.meta.glob("../../../../dist/component/**/*.js"),
  );
  const sellerId = await t.run((ctx) =>
    ctx.db.insert("users", {
      role: "seller",
      name: "Seller",
      email: "seller@example.com",
      stripeAccountId: "acct_store",
      storePlan: {
        planId: "growth",
        status: "active",
        paidThrough: 1794551000000,
        stripeSubscriptionId: "sub_store",
        cancelAtPeriodEnd: false,
      },
    }),
  );
  const base = {
    sellerId,
    currency: "usd",
    processingLoss: 100,
    disputeFees: 0,
    observedAt: 1,
    sourceGross: 10000,
    sourceProcessingFee: 320,
    expectedRevision: -1,
  };
  await t.mutation(internal.sellerCosts.billing.internal.mutations.record, {
    ...base,
    sourceChargeId: "ch_old",
    paymentIntentId: "pi_old",
    amountDue: 300,
  });
  await t.mutation(internal.sellerCosts.recoveryInvoices.mutations.prepare, {
    sellerId,
    invoiceId: "in_current",
    currency: "usd",
  });
  await t.mutation(internal.sellerCosts.billing.internal.mutations.record, {
    ...base,
    sourceChargeId: "ch_refund",
    paymentIntentId: "pi_refund",
    amountDue: 100,
    sourceType: "refund",
  });
  await t.mutation(internal.sellerCosts.billing.internal.mutations.record, {
    ...base,
    sourceChargeId: "ch_dispute",
    paymentIntentId: "pi_dispute",
    amountDue: -50,
    sourceType: "dispute",
  });
  preview.mockResolvedValue({
    currency: "usd",
    total: 4900,
    nextBillingAt: 1794551000000,
    lines: [{ id: "il_plan", description: "Growth monthly", amount: 4900 }],
  });
  const invoice = await t.action(api.sellerCosts.invoices.actions.estimate, {
    sellerId,
  });
  expect(invoice.total).toBe(4950);
  expect(invoice.lines).toHaveLength(3);
  expect(
    invoice.lines.map((line) => line.amount).sort((a, b) => a - b),
  ).toEqual([-50, 100, 4900]);
  expect(preview).toHaveBeenCalledWith(expect.anything(), {
    customerAccount: "acct_store",
    stripeSubscriptionId: "sub_store",
  });
});
it("includes all package obligations beyond the bounded itemized history", async () => {
  const t = convexTest(schema, modules);
  t.registerComponent(
    "betterStripe",
    componentSchema,
    import.meta.glob("../../../../dist/component/**/*.js"),
  );
  const sellerId = await t.run((ctx) =>
    ctx.db.insert("users", {
      role: "seller",
      name: "Seller",
      email: "seller@example.com",
      stripeAccountId: "acct_large",
      storePlan: {
        planId: "growth",
        status: "active",
        paidThrough: 1794551000000,
        stripeSubscriptionId: "sub_large",
        cancelAtPeriodEnd: false,
      },
    }),
  );
  const { components } = await import("../../_generated/api");
  for (let i = 0; i < 105; i++)
    await t.mutation(components.betterStripe.costRecovery.mutations.record, {
      accountId: "acct_large",
      scopeKey: `example:store:${sellerId}`,
      currency: "usd",
      claimKey: `large:${i}`,
      sourceChargeId: `ch_large_${i}`,
      sourceGross: 1000,
      sourceProcessingFee: 59,
      amountDue: 10,
      revision: 0,
    });
  preview.mockResolvedValue({
    currency: "usd",
    total: 4900,
    nextBillingAt: 1794551000000,
    lines: [{ id: "il_plan", description: "Growth monthly", amount: 4900 }],
  });
  const invoice = await t.action(api.sellerCosts.invoices.actions.estimate, {
    sellerId,
  });
  expect(invoice.total).toBe(5950);
  expect(invoice.lines.reduce((sum, line) => sum + line.amount, 0)).toBe(5950);
});
