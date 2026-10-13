// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, expect, it, vi } from "vitest";
import schema from "./schema";
import componentSchema from "../../dist/component/schema.js";
import { api, internal } from "./_generated/api";
const raw = vi.hoisted(() => ({
  paymentIntents: { retrieve: vi.fn() },
  subscriptions: { retrieve: vi.fn() },
  transfers: { list: vi.fn(), create: vi.fn() },
}));
vi.mock("./lib/stripeClient", () => ({ getStripeClient: () => raw }));
const modules = import.meta.glob("./**/*.*s");
const componentModules = import.meta.glob("../../dist/component/**/*.js");
beforeEach(() => {
  vi.resetAllMocks();
  raw.transfers.list.mockResolvedValue({ data: [] });
  raw.transfers.create.mockImplementation(async (args) => ({
    id: `tr_${args.destination}`,
    ...args,
  }));
});
async function setup(
  planId: "starter" | "growth" | "pro",
  referred = false,
  fee: number | null = 320,
) {
  const t = convexTest(schema, modules);
  t.registerComponent("betterStripe", componentSchema, componentModules);
  const sellerId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Seller",
      email: "seller@example.com",
      role: "seller",
      stripeAccountId: "acct_store",
      storePlan: {
        planId,
        status: "active",
        paidThrough: Date.now() + 86400000,
        stripeSubscriptionId: "sub_store",
        cancelAtPeriodEnd: false,
      },
    }),
  );
  const payment = {
    id: "pi_sale",
    status: "succeeded",
    amount_received: 10000,
    currency: "usd",
    metadata: {
      storeBilling: "sale_v1",
      sellerId,
      planId,
      userId: "customer",
      affiliateAccountId: referred ? "acct_affiliate" : "",
    },
    latest_charge: {
      id: "ch_sale",
      amount_refunded: 0,
      balance_transaction: fee === null ? null : { currency: "usd", fee },
    },
  };
  raw.paymentIntents.retrieve.mockResolvedValue(payment);
  return { t, sellerId, payment };
}
it.each([
  ["starter", 9100, 580],
  ["growth", 9510, 170],
  ["pro", 9680, 0],
] as const)(
  "pays the seller and records actual processing on %s, without duplicate payouts",
  async (planId, sellerNet, platformNet) => {
    const { t, sellerId } = await setup(planId);
    await t.action(internal.storeSaleSettlement.settle, {
      paymentIntentId: "pi_sale",
    });
    await t.action(internal.storeSaleSettlement.settle, {
      paymentIntentId: "pi_sale",
    });
    expect(raw.transfers.create).toHaveBeenCalledTimes(1);
    expect(raw.transfers.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: sellerNet,
        destination: "acct_store",
        source_transaction: "ch_sale",
      }),
      expect.objectContaining({
        idempotencyKey: "example_store_sale_ch_sale_store",
      }),
    );
    const sales = await t.query(api.storeSaleSettlement.listSellerSales, {
      sellerId,
    });
    expect(sales[0]).toMatchObject({
      sellerNet,
      platformNet,
      processingFee: 320,
      status: "settled",
    });
  },
);
it("waits for actual processing fees instead of guessing or overpaying recipients", async () => {
  const { t } = await setup("pro", false, null);
  await expect(
    t.action(internal.storeSaleSettlement.settle, {
      paymentIntentId: "pi_sale",
    }),
  ).rejects.toThrow(/not available yet/);
  expect(raw.transfers.create).not.toHaveBeenCalled();
});
it("takes high processing costs from the seller and pays the affiliate from the remainder", async () => {
  const { t, sellerId } = await setup("growth", true, 700);
  await t.action(internal.storeSaleSettlement.settle, {
    paymentIntentId: "pi_sale",
  });
  const [sale] = await t.query(api.storeSaleSettlement.listSellerSales, {
    sellerId,
  });
  expect(sale).toMatchObject({
    sellingFee: 700,
    platformNet: 0,
    sellerNet: 7440,
    affiliateNet: 1860,
  });
  expect(raw.transfers.create).toHaveBeenCalledTimes(2);
});
it("recovers a Stripe transfer after a crash without paying it twice", async () => {
  const { t } = await setup("growth");
  raw.transfers.list.mockResolvedValue({
    data: [
      {
        id: "tr_recovered",
        destination: "acct_store",
        amount: 9510,
        metadata: { storeSaleChargeId: "ch_sale", role: "store" },
      },
    ],
  });
  await t.action(internal.storeSaleSettlement.settle, {
    paymentIntentId: "pi_sale",
  });
  expect(raw.transfers.create).not.toHaveBeenCalled();
  expect(
    (
      await t.query(internal.storeSaleSettlement.getByCharge, {
        chargeId: "ch_sale",
      })
    )?.sellerTransferId,
  ).toBe("tr_recovered");
});
it("settles a recurring invoice from the subscription's seller and referral metadata", async () => {
  const { t, payment, sellerId } = await setup("starter", true);
  raw.subscriptions.retrieve.mockResolvedValue({ metadata: payment.metadata });
  raw.paymentIntents.retrieve.mockResolvedValue({ ...payment, metadata: {} });
  await t.action(internal.storeSaleSettlement.settle, {
    paymentIntentId: "pi_sale",
    subscriptionId: "sub_customer",
    invoiceId: "in_monthly",
  });
  expect(
    (await t.query(api.storeSaleSettlement.listSellerSales, { sellerId }))[0],
  ).toMatchObject({
    sourceInvoiceId: "in_monthly",
    affiliateNet: 1820,
    sellerNet: 7280,
  });
});

it("recovers seller costs once before transferring earnings and bills only the remainder", async () => {
  const { t, sellerId } = await setup("growth");
  await t.mutation(internal.sellerCostBilling.record, {
    sellerId,
    sourceChargeId: "ch_refund",
    paymentIntentId: "pi_refund",
    currency: "usd",
    amountDue: 10000,
    processingLoss: 10000,
    disputeFees: 0,
    observedAt: 1,
  });
  await t.action(internal.storeSaleSettlement.settle, {
    paymentIntentId: "pi_sale",
  });
  await t.action(internal.storeSaleSettlement.settle, {
    paymentIntentId: "pi_sale",
  });
  const [sale] = await t.query(api.storeSaleSettlement.listSellerSales, {
    sellerId,
  });
  expect(sale).toMatchObject({
    sellerNet: 0,
    costRecoveryAmount: 9510,
    status: "settled",
  });
  expect(raw.transfers.create).not.toHaveBeenCalled();
  const [cost] = await t.query(api.sellerCostBilling.list, { sellerId });
  expect(cost).toMatchObject({ collectedAmount: 9510, outstanding: 490 });
  const bill = await t.mutation(internal.sellerCostBilling.claimInvoice, {
    sellerId,
    invoiceId: "in_next_month",
    currency: "usd",
  });
  const retry = await t.mutation(internal.sellerCostBilling.claimInvoice, {
    sellerId,
    invoiceId: "in_next_month",
    currency: "usd",
  });
  expect(bill?.amount).toBe(490);
  expect(retry?._id).toBe(bill?._id);
  expect(
    (await t.query(api.sellerCostBilling.list, { sellerId }))[0],
  ).toMatchObject({ invoicedAmount: 490, outstanding: 0 });
  expect(
    await t.mutation(internal.sellerCostBilling.claimInvoice, {
      sellerId,
      invoiceId: "in_following_month",
      currency: "usd",
    }),
  ).toBeNull();
});

it("returns credited costs once without exceeding the charge transfer limit", async () => {
  const { t, sellerId } = await setup("growth");
  const costArgs = {
    sellerId,
    sourceChargeId: "ch_old",
    paymentIntentId: "pi_old",
    currency: "usd",
    processingLoss: 0,
    disputeFees: 0,
  };
  await t.mutation(internal.sellerCostBilling.record, {
    ...costArgs,
    amountDue: -1000,
    observedAt: 2,
  });
  await t.mutation(internal.sellerCostBilling.record, {
    ...costArgs,
    amountDue: 1000,
    observedAt: 1,
  });
  await t.action(internal.storeSaleSettlement.settle, {
    paymentIntentId: "pi_sale",
  });
  expect(raw.transfers.create).toHaveBeenCalledWith(
    expect.objectContaining({ amount: 10000 }),
    expect.anything(),
  );
  const [cost] = await t.query(api.sellerCostBilling.list, { sellerId });
  expect(cost).toMatchObject({
    amountDue: -1000,
    collectedAmount: -490,
    outstanding: -510,
  });
});
it("retries settlement itself when Stripe fees arrive after the webhook", async () => {
  vi.useFakeTimers();
  try {
    const { t, payment } = await setup("growth", false, null);
    await t.action(internal.storeSaleSettlement.settleWhenReady, {
      paymentIntentId: "pi_sale",
    });
    expect(raw.transfers.create).not.toHaveBeenCalled();
    raw.paymentIntents.retrieve.mockResolvedValue({
      ...payment,
      latest_charge: {
        ...payment.latest_charge,
        balance_transaction: { currency: "usd", fee: 320 },
      },
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(raw.transfers.create).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
