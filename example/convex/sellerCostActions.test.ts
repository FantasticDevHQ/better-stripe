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
it("records actual non-refundable costs and adds them to the monthly invoice once", async () => {
  const { t, sellerId } = await setup();
  await t.action(internal.sellerCostActions.reconcile, {
    paymentIntentId: "pi_sale",
  });
  expect(
    (await t.query(api.sellerCostBilling.list, { sellerId }))[0],
  ).toMatchObject({ amountDue: 320, outstanding: 320 });
  await t.action(internal.sellerCostActions.attachToInvoice, {
    sellerId,
    invoiceId: "in_monthly",
  });
  await t.action(internal.sellerCostActions.attachToInvoice, {
    sellerId,
    invoiceId: "in_monthly",
  });
  expect(raw.invoiceItems.create).toHaveBeenCalledTimes(1);
  expect(raw.invoiceItems.create).toHaveBeenCalledWith(
    expect.objectContaining({
      invoice: "in_monthly",
      amount: 320,
      customer_account: "acct_store",
    }),
    expect.objectContaining({
      idempotencyKey: expect.stringContaining("better-stripe:recovery:"),
    }),
  );
  expect(
    (await t.query(api.sellerCostBilling.list, { sellerId }))[0],
  ).toMatchObject({ invoicedAmount: 320, outstanding: 0 });
});
it("waits for Stripe refund costs rather than recording an estimate", async () => {
  const { t, sellerId } = await setup();
  client.getProcessingCostContext.mockResolvedValue({
    status: "not_ready",
    reason: "refund_transaction_unavailable",
  });
  await expect(
    t.action(internal.sellerCostActions.reconcile, {
      paymentIntentId: "pi_sale",
    }),
  ).rejects.toThrow(/not available/);
  expect(await t.query(api.sellerCostBilling.list, { sellerId })).toHaveLength(
    0,
  );
});
it("turns returned Stripe fees into a credit after the seller was already billed", async () => {
  const { t, sellerId } = await setup();
  await t.action(internal.sellerCostActions.reconcile, {
    paymentIntentId: "pi_sale",
  });
  await t.action(internal.sellerCostActions.attachToInvoice, {
    sellerId,
    invoiceId: "in_monthly",
  });
  client.getProcessingCostContext.mockResolvedValue({
    ...costContext,
    refundFeeAdjustment: -320,
  });
  await t.action(internal.sellerCostActions.reconcile, {
    paymentIntentId: "pi_sale",
  });
  expect(
    (await t.query(api.sellerCostBilling.list, { sellerId }))[0],
  ).toMatchObject({ amountDue: 0, outstanding: -320, open: true });
});
it("refuses another seller's invoice and keeps missing finalized adjustments held", async () => {
  const { t, sellerId } = await setup();
  raw.invoices.retrieve.mockResolvedValue({
    id: "in_monthly",
    customer_account: "acct_other",
    status: "draft",
  });
  await expect(
    t.action(internal.sellerCostActions.attachToInvoice, {
      sellerId,
      invoiceId: "in_monthly",
    }),
  ).rejects.toThrow(/another Stripe account/);
  raw.invoices.retrieve.mockResolvedValue({
    id: "in_monthly",
    customer_account: "acct_store",
    currency: "usd",
    status: "open",
  });
  await expect(
    t.action(internal.sellerCostActions.attachToInvoice, {
      sellerId,
      invoiceId: "in_monthly",
    }),
  ).rejects.toThrow(/missing/i);
  expect(raw.invoiceItems.create).not.toHaveBeenCalled();
});
it("retries when the actual refund fee is delayed", async () => {
  vi.useFakeTimers();
  try {
    const { t, sellerId } = await setup();
    client.getProcessingCostContext.mockResolvedValue({
      status: "not_ready",
      reason: "refund_transaction_unavailable",
    });
    await t.action(internal.sellerCostActions.reconcileWhenReady, {
      paymentIntentId: "pi_sale",
    });
    expect(
      await t.query(api.sellerCostBilling.list, { sellerId }),
    ).toHaveLength(0);
    client.getProcessingCostContext.mockResolvedValue(costContext);
    client.getPriceByStripeId.mockResolvedValue({
      stripeProductId: "prod_store",
      currency: "usd",
    });
    client.getProductByStripeId.mockResolvedValue({ accountId: "acct_store" });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(
      (await t.query(api.sellerCostBilling.list, { sellerId }))[0].amountDue,
    ).toBe(320);
  } finally {
    vi.useRealTimers();
  }
});

it("records actual costs for a disputed source that never settled without paying or fabricating a sale", async () => {
  const { t, sellerId } = await setup();
  await t.run(async (ctx) => {
    const sale = await ctx.db
      .query("storeSales")
      .withIndex("by_charge", (q) => q.eq("chargeId", "ch_sale"))
      .first();
    await ctx.db.delete("storeSales", sale!._id);
  });
  client.getProcessingCostContext.mockResolvedValue({
    ...costContext,
    metadata: {
      storeBilling: "sale_v1",
      sellerId,
      stripePriceId: "price_store",
      stripeProductId: "prod_store",
    },
    disputeFeeAdjustment: 1500,
    disputes: [{ id: "dp_original" }],
  });
  await t.action(internal.sellerCostActions.reconcile, {
    paymentIntentId: "pi_sale",
  });
  expect(
    await t.query(internal.storeSaleSettlement.getByCharge, {
      chargeId: "ch_sale",
    }),
  ).toBeNull();
  expect(
    (await t.query(api.sellerCostBilling.list, { sellerId }))[0],
  ).toMatchObject({
    amountDue: 1820,
    processingLoss: 320,
    disputeFees: 1500,
    outstanding: 1820,
  });
});
it("rejects seller metadata that is not bound to the source product's owner", async () => {
  const { t, sellerId } = await setup();
  await t.run(async (ctx) => {
    const sale = await ctx.db.query("storeSales").first();
    await ctx.db.delete("storeSales", sale!._id);
  });
  client.getProcessingCostContext.mockResolvedValue({
    ...costContext,
    metadata: {
      storeBilling: "sale_v1",
      sellerId,
      stripePriceId: "price_store",
    },
  });
  client.getProductByStripeId.mockResolvedValue({ accountId: "acct_other" });
  await expect(
    t.action(internal.sellerCostActions.reconcile, {
      paymentIntentId: "pi_sale",
    }),
  ).rejects.toThrow(/owner/i);
  expect(await t.query(api.sellerCostBilling.list, { sellerId })).toHaveLength(
    0,
  );
});

it("resolves a disputed subscription source through its verified paid invoice instead of relying on PaymentIntent metadata", async () => {
  const { t, sellerId } = await setup();
  await t.run(async (ctx) => {
    const sale = await ctx.db.query("storeSales").first();
    await ctx.db.delete("storeSales", sale!._id);
  });
  client.getProcessingCostContext.mockResolvedValue({
    ...costContext,
    metadata: {},
    disputes: [{ id: "dp_subscription" }],
    disputeFeeAdjustment: 1500,
  });
  raw.invoicePayments.list.mockImplementation(() =>
    (async function* () {
      yield {
        invoice: "in_original",
        status: "paid",
        amount_paid: 10000,
        currency: "usd",
        payment: { type: "payment_intent", payment_intent: "pi_sale" },
      };
    })(),
  );
  raw.invoices.retrieve.mockResolvedValue({
    id: "in_original",
    status: "paid",
    amount_paid: 10000,
    currency: "usd",
    customer_account: "acct_buyer",
    parent: { subscription_details: { subscription: "sub_original" } },
  });
  raw.invoices.listLineItems.mockImplementation(() =>
    (async function* () {
      yield {
        pricing: {
          price_details: { price: "price_original", product: "prod_store" },
        },
      };
    })(),
  );
  raw.subscriptions.retrieve.mockResolvedValue({
    id: "sub_original",
    customer_account: "acct_buyer",
    metadata: {
      storeBilling: "sale_v1",
      sellerId,
      stripePriceId: "price_store",
      stripeProductId: "prod_store",
    },
  });
  await t.action(internal.sellerCostActions.reconcile, {
    paymentIntentId: "pi_sale",
  });
  expect(
    (await t.query(api.sellerCostBilling.list, { sellerId }))[0],
  ).toMatchObject({ amountDue: 1820 });
  expect(
    await t.query(internal.storeSaleSettlement.getByCharge, {
      chargeId: "ch_sale",
    }),
  ).toBeNull();
  expect(client.getPriceByStripeId).toHaveBeenLastCalledWith(
    expect.anything(),
    { stripePriceId: "price_original" },
  );
  raw.invoices.retrieve.mockResolvedValue({
    id: "in_original",
    status: "paid",
    amount_paid: 9999,
    currency: "usd",
    customer_account: "acct_buyer",
    parent: { subscription_details: { subscription: "sub_original" } },
  });
  await expect(
    t.action(internal.sellerCostActions.reconcile, {
      paymentIntentId: "pi_sale",
    }),
  ).rejects.toThrow(/allocation/i);
});
it("commits recovery on paid invoice outcomes and releases void outcomes without double collection", async () => {
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
    status: "open",
  });
  await t.action(internal.recoveryInvoices.reconcile, {
    sellerId,
    invoiceId: "in_monthly",
  });
  expect(
    (await t.query(api.sellerCostBilling.list, { sellerId }))[0],
  ).toMatchObject({ collectedAmount: 0, reservedAmount: 320, outstanding: 0 });
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
  await t.action(internal.recoveryInvoices.reconcile, {
    sellerId,
    invoiceId: "in_monthly",
  });
  expect(
    (await t.query(api.sellerCostBilling.list, { sellerId }))[0],
  ).toMatchObject({ collectedAmount: 320, reservedAmount: 0, outstanding: 0 });
  const other = await setup();
  await other.t.action(internal.sellerCostActions.reconcile, {
    paymentIntentId: "pi_sale",
  });
  await other.t.action(internal.sellerCostActions.attachToInvoice, {
    sellerId: other.sellerId,
    invoiceId: "in_monthly",
  });
  raw.invoices.retrieve.mockResolvedValue({
    id: "in_monthly",
    customer_account: "acct_store",
    currency: "usd",
    status: "void",
  });
  await other.t.action(internal.recoveryInvoices.reconcile, {
    sellerId: other.sellerId,
    invoiceId: "in_monthly",
  });
  expect(
    (
      await other.t.query(api.sellerCostBilling.list, {
        sellerId: other.sellerId,
      })
    )[0],
  ).toMatchObject({ collectedAmount: 0, reservedAmount: 0, outstanding: 320 });
});
