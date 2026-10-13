// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
const raw = vi.hoisted(() => ({ invoices: { createPreview: vi.fn() } }));
vi.mock("./lib/stripeClient", () => ({ getStripeClient: () => raw }));
const modules = import.meta.glob("./**/*.*s");
it("itemizes outstanding costs and credits without adding already-invoiced costs twice", async () => {
  const t = convexTest(schema, modules);
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
  };
  await t.mutation(internal.sellerCostBilling.record, {
    ...base,
    sourceChargeId: "ch_old",
    paymentIntentId: "pi_old",
    amountDue: 300,
  });
  await t.mutation(internal.sellerCostBilling.claimInvoice, {
    sellerId,
    invoiceId: "in_current",
    currency: "usd",
  });
  await t.mutation(internal.sellerCostBilling.record, {
    ...base,
    sourceChargeId: "ch_refund",
    paymentIntentId: "pi_refund",
    amountDue: 100,
    sourceType: "refund",
  });
  await t.mutation(internal.sellerCostBilling.record, {
    ...base,
    sourceChargeId: "ch_dispute",
    paymentIntentId: "pi_dispute",
    amountDue: -50,
    sourceType: "dispute",
  });
  raw.invoices.createPreview.mockResolvedValue({
    currency: "usd",
    total: 4900,
    lines: {
      has_more: false,
      data: [{ id: "il_plan", description: "Growth monthly", amount: 4900 }],
    },
  });
  const invoice = await t.action(api.storeInvoiceActions.estimate, {
    sellerId,
  });
  expect(invoice.total).toBe(4950);
  expect(invoice.lines).toHaveLength(3);
  expect(
    invoice.lines.map((line) => line.amount).sort((a, b) => a - b),
  ).toEqual([-50, 100, 4900]);
  expect(raw.invoices.createPreview).toHaveBeenCalledWith({
    customer_account: "acct_store",
    subscription: "sub_store",
  });
});
