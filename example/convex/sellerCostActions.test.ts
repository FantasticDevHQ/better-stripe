// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
const raw = vi.hoisted(() => ({
  invoices: { retrieve: vi.fn() },
  invoiceItems: { list: vi.fn(), create: vi.fn() },
}));
vi.mock("./lib/stripeClient", () => ({ getStripeClient: () => raw }));
const client = vi.hoisted(() => ({ getProcessingCostContext: vi.fn() }));
vi.mock("./stripe", () => ({ stripe: client }));
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
  raw.invoices.retrieve.mockResolvedValue({
    id: "in_monthly",
    customer_account: "acct_store",
    currency: "usd",
    status: "draft",
  });
  raw.invoiceItems.list.mockResolvedValue({ data: [] });
  raw.invoiceItems.create.mockResolvedValue({ id: "ii_costs" });
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
      idempotencyKey: expect.stringContaining("example_seller_cost_bill_"),
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
it("refuses another seller's invoice and finalized invoices", async () => {
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
    status: "open",
  });
  await expect(
    t.action(internal.sellerCostActions.attachToInvoice, {
      sellerId,
      invoiceId: "in_monthly",
    }),
  ).rejects.toThrow(/before.*finalized/);
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
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(
      (await t.query(api.sellerCostBilling.list, { sellerId }))[0].amountDue,
    ).toBe(320);
  } finally {
    vi.useRealTimers();
  }
});
