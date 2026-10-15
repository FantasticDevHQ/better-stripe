// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, expect, it, vi } from "vitest";
import schema from "./schema";
import componentSchema from "../../dist/component/schema.js";
import { api, internal } from "./_generated/api";
const raw = vi.hoisted(() => ({
  invoices: { retrieve: vi.fn(), listLineItems: vi.fn() },
  invoiceItems: { list: vi.fn(), create: vi.fn() },
  invoicePayments: { list: vi.fn() },
  subscriptions: { retrieve: vi.fn() },
}));
vi.mock("./lib/stripeClient", () => ({ getStripeClient: () => raw }));
const client = vi.hoisted(() => ({
  getProcessingCostContext: vi.fn(),
  getPriceByStripeId: vi.fn(),
  getProductByStripeId: vi.fn(),
}));
vi.mock("./stripe", async () => {
  const { CostRecoveryClient } = await import("../../src/client/costRecovery");
  const { components } = await import("./_generated/api");
  return {
    stripe: {
      ...client,
      costRecovery: new CostRecoveryClient(
        components.betterStripe,
        () => raw as unknown as import("stripe").default,
      ),
    },
  };
});
const costContext = {
  status: "ready",
  paymentIntentId: "pi_sale",
  chargeId: "ch_sale",
  currency: "usd",
  gross: 10000,
  metadata: {},
  processingFee: 320,
  refundFeeAdjustment: 0,
  disputeFeeAdjustment: 0,
  principalReturned: 10000,
  disputes: [],
};
const modules = import.meta.glob("./**/*.*s");
beforeEach(() => vi.resetAllMocks());
async function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent(
    "betterStripe",
    componentSchema,
    import.meta.glob("../../dist/component/**/*.js"),
  );
  const sellerId = await t.run((ctx) =>
    ctx.db.insert("users", {
      role: "seller",
      name: "Seller",
      email: "seller@example.com",
      stripeAccountId: "acct_store",
    }),
  );
  await t.run((ctx) =>
    ctx.db.insert("storeSales", {
      chargeId: "ch_sale",
      paymentIntentId: "pi_sale",
      sellerId,
      sellerAccountId: "acct_store",
      planId: "growth",
      gross: 10000,
      processingFee: 320,
      sellingFee: 490,
      platformNet: 170,
      sellerNet: 9510,
      affiliateNet: 0,
      currency: "usd",
      status: "settled",
    }),
  );
  client.getProcessingCostContext.mockResolvedValue(costContext);
  client.getPriceByStripeId.mockResolvedValue({
    stripeProductId: "prod_store",
    currency: "usd",
  });
  client.getProductByStripeId.mockResolvedValue({ accountId: "acct_store" });
  raw.invoices.retrieve.mockResolvedValue({
    id: "in_monthly",
    customer_account: "acct_store",
    currency: "usd",
    status: "draft",
  });
  const items: Record<string, unknown>[] = [];
  raw.invoiceItems.list.mockImplementation(() =>
    (async function* () {
      for (const item of items) yield item;
    })(),
  );
  raw.invoiceItems.create.mockImplementation(async (args) => {
    const item = { ...args, id: "ii_costs" };
    items.push(item);
    return item;
  });
  return { t, sellerId };
}
it("routes a returned invoice funding payment to package rollback and refuses ambiguous allocation", async () => {
  const { t, sellerId } = await setup();
  await t.action(internal.sellerCostActions.reconcile, {
    paymentIntentId: "pi_sale",
  });
  await t.action(internal.sellerCostActions.attachToInvoice, {
    sellerId,
    invoiceId: "in_monthly",
  });
  raw.invoices.retrieve.mockResolvedValue({
    id: "in_monthly",
    customer_account: "acct_store",
    currency: "usd",
    status: "paid",
  });
  await t.action(internal.recoveryInvoices.reconcile, {
    sellerId,
    invoiceId: "in_monthly",
  });
  client.getProcessingCostContext.mockResolvedValue({
    ...costContext,
    paymentIntentId: "pi_funding",
    chargeId: "ch_funding",
    gross: 1220,
    processingFee: 65,
    principalReturned: 610,
  });
  raw.invoicePayments.list.mockImplementation(() =>
    (async function* () {
      yield {
        invoice: "in_monthly",
        currency: "usd",
        status: "paid",
        payment: { type: "payment_intent", payment_intent: "pi_funding" },
      };
    })(),
  );
  const { stripe } = await import("./stripe");
  const rollback = vi
    .spyOn(stripe.costRecovery, "rollbackInvoice")
    .mockResolvedValue({
      status: "not_ready",
      reason: "invoice_funding_allocation_required",
    });
  try {
    await expect(
      t.action(internal.sellerCostActions.reconcile, {
        paymentIntentId: "pi_funding",
      }),
    ).rejects.toThrow(/allocation_required/);
    expect(rollback).toHaveBeenCalledWith(expect.anything(), {
      accountId: "acct_store",
      scopeKey: `example:store:${sellerId}`,
      currency: "usd",
      groupKey: "example:cost-invoice:in_monthly",
      revision: 0,
    });
  } finally {
    rollback.mockRestore();
  }
});
it("reinstates refunded invoice-funded recovery and passes uncovered processing fees to the seller", async () => {
  const { t, sellerId } = await setup();
  await t.action(internal.sellerCostActions.reconcile, {
    paymentIntentId: "pi_sale",
  });
  await t.action(internal.sellerCostActions.attachToInvoice, {
    sellerId,
    invoiceId: "in_monthly",
  });
  raw.invoices.retrieve.mockResolvedValue({
    id: "in_monthly",
    customer_account: "acct_store",
    currency: "usd",
    status: "paid",
  });
  await t.action(internal.recoveryInvoices.reconcile, {
    sellerId,
    invoiceId: "in_monthly",
  });
  let returned = 610;
  client.getProcessingCostContext.mockImplementation(async () => ({
    ...costContext,
    paymentIntentId: "pi_funding",
    chargeId: "ch_funding",
    gross: 1220,
    processingFee: 65,
    principalReturned: returned,
  }));
  raw.invoicePayments.list.mockImplementation(() =>
    (async function* () {
      yield {
        invoice: "in_monthly",
        currency: "usd",
        status: "paid",
        payment: { type: "payment_intent", payment_intent: "pi_funding" },
      };
    })(),
  );
  const { stripe } = await import("./stripe");
  const { components } = await import("./_generated/api");
  const rollback = vi
    .spyOn(stripe.costRecovery, "rollbackInvoice")
    .mockImplementation(async (ctx, opts) => {
      await ctx.runMutation!(
        components.betterStripe.costRecovery.mutations.bindInvoiceFunding,
        {
          groupKey: opts.groupKey,
          sourceChargeId: "ch_funding",
          sourceGross: 1220,
          sourceProcessingFee: 65,
        },
      );
      return {
        status: "ready" as const,
        claim: await stripe.costRecovery.rollback(ctx, {
          groupKey: opts.groupKey,
          returnedPrincipal: returned,
          revision: opts.revision,
        }),
      };
    });
  try {
    await t.action(internal.sellerCostActions.reconcile, {
      paymentIntentId: "pi_funding",
    });
    expect(
      (await t.query(api.sellerCostBilling.list, { sellerId })).find(
        (row) => row.paymentIntentId === "pi_funding",
      ),
    ).toMatchObject({ amountDue: 160, processingLoss: 0, outstanding: 160 });
    returned = 1220;
    await t.action(internal.sellerCostActions.reconcile, {
      paymentIntentId: "pi_funding",
    });
    await t.action(internal.sellerCostActions.reconcile, {
      paymentIntentId: "pi_funding",
    });
    expect(
      (await t.query(api.sellerCostBilling.list, { sellerId })).find(
        (row) => row.paymentIntentId === "pi_funding",
      ),
    ).toMatchObject({ amountDue: 385, processingLoss: 65, outstanding: 385 });
  } finally {
    rollback.mockRestore();
  }
});
