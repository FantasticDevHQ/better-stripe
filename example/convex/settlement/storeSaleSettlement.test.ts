import { runAction } from "../../testing/settlement/providerFixture";
import workflowTest from "@convex-dev/workflow/test";
import { modules } from "../../test";
// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, expect, it, vi } from "vitest";
import componentSchema from "../../../dist/component/schema.js";
import { api, components, internal } from "../_generated/api";
import schema from "../schema";
const raw = vi.hoisted(() => ({
  charges: { retrieve: vi.fn() },
  paymentIntents: { retrieve: vi.fn() },
  subscriptions: { retrieve: vi.fn() },
  invoices: { list: vi.fn(), retrieve: vi.fn() },
  invoicePayments: { list: vi.fn() },
  transfers: { list: vi.fn(), create: vi.fn() },
}));
vi.mock("../stripe/client", () => ({ getStripeClient: () => raw }));
vi.mock("../stripe/helpers", async () => {
  const { getVerifiedSale } =
    await import("../../../src/client/settlement/verifiedSale");
  const { selectCommissionInvoice } =
    await import("../../../src/client/settlement/commissions");
  const { settleSale } =
    await import("../../../src/client/settlement/settleSale");
  const { components } = await import("../_generated/api");
  const sdk = raw as unknown as import("stripe").default;
  const { fixtureRecoveryClient } =
    await import("../../testing/settlement/providerFixture");
  return {
    stripe: {
      costRecovery: fixtureRecoveryClient(components.betterStripe, sdk),
      getVerifiedSale: async (
        _ctx: unknown,
        opts: Parameters<typeof getVerifiedSale>[1],
      ) => {
        if (opts.invoiceId)
          raw.invoices.retrieve.mockResolvedValue({
            id: opts.invoiceId,
            status: "paid",
            amount_paid: 10000,
            currency: "usd",
            parent: {
              subscription_details: { subscription: opts.subscriptionId },
            },
          });
        raw.invoicePayments.list.mockImplementation(async (params) => ({
          data: [
            {
              status: "paid",
              payment: { payment_intent: params.payment.payment_intent },
            },
          ],
          has_more: false,
        }));
        if (opts.subscriptionId) {
          const sub = await raw.subscriptions.retrieve(opts.subscriptionId);
          if (!sub.items)
            raw.subscriptions.retrieve.mockResolvedValue({
              ...sub,
              items: {
                data: [
                  { price: { id: "price_default", product: "prod_default" } },
                ],
              },
            });
        }
        return getVerifiedSale(sdk, opts);
      },
      selectCommissionInvoice: (
        ctx: Parameters<typeof selectCommissionInvoice>[2],
        opts: Parameters<typeof selectCommissionInvoice>[3],
      ) => selectCommissionInvoice(sdk, components.betterStripe, ctx, opts),
      settleSale: (
        ctx: Parameters<typeof settleSale>[2],
        opts: Parameters<typeof settleSale>[3],
      ) => settleSale(sdk, components.betterStripe, ctx, opts),
    },
  };
});
const componentModules = import.meta.glob("../../../dist/component/**/*.js");
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  raw.charges.retrieve.mockResolvedValue({ created: 1 });
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
  await t.mutation(components.betterStripe.products.mutations.upsertProduct, {
    stripeProductId: "prod_default",
    accountId: "acct_store",
    name: "Membership",
    active: true,
  });
  await t.mutation(components.betterStripe.products.mutations.upsertPrice, {
    stripePriceId: "price_default",
    stripeProductId: "prod_default",
    productId: "product",
    unitAmount: 10000,
    currency: "usd",
    type: "recurring",
    interval: "month",
    active: true,
  });
  workflowTest.register(t, "betterStripe/workflow");
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
  if (referred)
    await t.run((ctx) =>
      ctx.db.insert("affiliateDefaults", {
        affiliateBasisPoints: 2000,
        affiliateFixedAmount: null,
        version: 1,
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
      amount: 10000,
      currency: "usd",
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
    await runAction(t, internal.settlement.internal.actions.settle, {
      paymentIntentId: "pi_sale",
    });
    await runAction(t, internal.settlement.internal.actions.settle, {
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
        idempotencyKey: "bs_split_ch_sale_acct_store_store",
      }),
    );
    const sales = await t.query(api.settlement.public.queries.listSellerSales, {
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
    t.action(internal.settlement.internal.actions.settleWhenReady, {
      paymentIntentId: "pi_sale",
      attempt: 10,
    }),
  ).rejects.toThrow(/fee_pending/);
  expect(raw.transfers.create).not.toHaveBeenCalled();
  expect(
    await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect()),
  ).toHaveLength(0);
});
it("takes high processing costs from the seller and pays the affiliate from the remainder", async () => {
  const { t, sellerId } = await setup("growth", true, 700);
  await runAction(t, internal.settlement.internal.actions.settle, {
    paymentIntentId: "pi_sale",
  });
  const [sale] = await t.query(api.settlement.public.queries.listSellerSales, {
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
        currency: "usd",
        source_transaction: "ch_sale",
        destination: "acct_store",
        amount: 9510,
        metadata: { storeSaleChargeId: "ch_sale", role: "store" },
      },
    ],
  });
  await runAction(t, internal.settlement.internal.actions.settle, {
    paymentIntentId: "pi_sale",
  });
  expect(raw.transfers.create).not.toHaveBeenCalled();
  expect(
    (
      await t.query(internal.settlement.internal.queries.getByCharge, {
        chargeId: "ch_sale",
      })
    )?.sellerTransferId,
  ).toBe("tr_recovered");
});
it("settles a recurring invoice from the subscription's seller and referral metadata", async () => {
  const { t, payment, sellerId } = await setup("starter", true);
  raw.subscriptions.retrieve.mockResolvedValue({ metadata: payment.metadata });
  raw.paymentIntents.retrieve.mockResolvedValue({ ...payment, metadata: {} });
  await runAction(t, internal.settlement.internal.actions.settle, {
    paymentIntentId: "pi_sale",
    subscriptionId: "sub_customer",
    invoiceId: "in_monthly",
  });
  expect(
    (
      await t.query(api.settlement.public.queries.listSellerSales, { sellerId })
    )[0],
  ).toMatchObject({
    sourceInvoiceId: "in_monthly",
    affiliateNet: 1820,
    sellerNet: 7280,
  });
});

it("recovers seller costs once before transferring earnings and bills only the remainder", async () => {
  const { t, sellerId } = await setup("growth");
  await t.mutation(internal.sellerCosts.billing.internal.mutations.record, {
    sellerId,
    sourceChargeId: "ch_refund",
    paymentIntentId: "pi_refund",
    currency: "usd",
    amountDue: 10000,
    processingLoss: 10000,
    disputeFees: 0,
    observedAt: 1,
    sourceGross: 10000,
    sourceProcessingFee: 320,
    expectedRevision: -1,
  });
  await runAction(t, internal.settlement.internal.actions.settle, {
    paymentIntentId: "pi_sale",
  });
  await runAction(t, internal.settlement.internal.actions.settle, {
    paymentIntentId: "pi_sale",
  });
  const [sale] = await t.query(api.settlement.public.queries.listSellerSales, {
    sellerId,
  });
  expect(sale).toMatchObject({
    sellerNet: 0,
    costRecoveryAmount: 9510,
    status: "settled",
  });
  expect(raw.transfers.create).not.toHaveBeenCalled();
  const [cost] = await t.query(api.sellerCosts.billing.public.queries.list, {
    sellerId,
  });
  expect(cost).toMatchObject({ collectedAmount: 9510, outstanding: 490 });
  await t.mutation(internal.sellerCosts.recoveryInvoices.mutations.prepare, {
    sellerId,
    invoiceId: "in_next_month",
    currency: "usd",
  });
  await t.mutation(internal.sellerCosts.recoveryInvoices.mutations.prepare, {
    sellerId,
    invoiceId: "in_next_month",
    currency: "usd",
  });
  expect(
    await t.query(components.betterStripe.costRecovery.queries.group, {
      groupKey: "example:cost-invoice:in_next_month",
    }),
  ).toMatchObject({ amount: 490, status: "sealed" });
  expect(
    (
      await t.query(api.sellerCosts.billing.public.queries.list, { sellerId })
    )[0],
  ).toMatchObject({ invoicedAmount: 490, outstanding: 0 });
  expect(
    await t.mutation(internal.sellerCosts.recoveryInvoices.mutations.prepare, {
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
    sourceGross: 10000,
    sourceProcessingFee: 320,
    expectedRevision: -1,
  };
  await t.mutation(internal.sellerCosts.billing.internal.mutations.record, {
    ...costArgs,
    amountDue: -1000,
    observedAt: 2,
  });
  await expect(
    t.mutation(internal.sellerCosts.billing.internal.mutations.record, {
      ...costArgs,
      amountDue: 1000,
      observedAt: 1,
    }),
  ).rejects.toThrow(/observation changed/);
  await runAction(t, internal.settlement.internal.actions.settle, {
    paymentIntentId: "pi_sale",
  });
  expect(raw.transfers.create).toHaveBeenCalledWith(
    expect.objectContaining({ amount: 10000 }),
    expect.anything(),
  );
  const [cost] = await t.query(api.sellerCosts.billing.public.queries.list, {
    sellerId,
  });
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
    await t.action(internal.settlement.internal.actions.settleWhenReady, {
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
it("applies admin-configured sale fees and keeps settled economics unchanged on retry", async () => {
  const { t, sellerId } = await setup("starter", true);
  const settingsId = await t.run((ctx) =>
    ctx.db.insert("storePlanSettings", {
      planId: "starter",
      monthlyAmount: 1200,
      feeBasisPoints: 750,
      version: 1,
    }),
  );
  await runAction(t, internal.settlement.internal.actions.settle, {
    paymentIntentId: "pi_sale",
  });
  const [sale] = await t.query(api.settlement.public.queries.listSellerSales, {
    sellerId,
  });
  expect(sale).toMatchObject({
    sellingFee: 750,
    processingFee: 320,
    platformNet: 430,
    sellerNet: 7400,
    affiliateNet: 1850,
  });
  await t.run((ctx) =>
    ctx.db.patch("storePlanSettings", settingsId, {
      feeBasisPoints: 9000,
      version: 2,
    }),
  );
  await runAction(t, internal.settlement.internal.actions.settle, {
    paymentIntentId: "pi_sale",
  });
  expect(
    (
      await t.query(api.settlement.public.queries.listSellerSales, { sellerId })
    )[0],
  ).toEqual(sale);
  expect(raw.transfers.create).toHaveBeenCalledTimes(2);
});
it("uses the plan's affiliate rate and records it without recalculating settled sales", async () => {
  const { t, sellerId } = await setup("growth", true);
  const settingsId = await t.run((ctx) =>
    ctx.db.insert("storePlanSettings", {
      planId: "growth",
      monthlyAmount: 4900,
      feeBasisPoints: 490,
      affiliateBasisPoints: 1250,
      version: 1,
    }),
  );
  await runAction(t, internal.settlement.internal.actions.settle, {
    paymentIntentId: "pi_sale",
  });
  const [sale] = await t.query(api.settlement.public.queries.listSellerSales, {
    sellerId,
  });
  expect(sale).toMatchObject({
    affiliateBasisPoints: 1250,
    affiliateNet: 1188,
    sellerNet: 8322,
    platformNet: 170,
    processingFee: 320,
  });
  await t.run((ctx) =>
    ctx.db.patch("storePlanSettings", settingsId, {
      affiliateBasisPoints: 9500,
      version: 2,
    }),
  );
  await runAction(t, internal.settlement.internal.actions.settle, {
    paymentIntentId: "pi_sale",
  });
  expect(
    (
      await t.query(api.settlement.public.queries.listSellerSales, { sellerId })
    )[0],
  ).toEqual(sale);
  expect(raw.transfers.create).toHaveBeenCalledWith(
    expect.objectContaining({ destination: "acct_affiliate", amount: 1188 }),
    expect.anything(),
  );
  expect(raw.transfers.create).toHaveBeenCalledTimes(2);
});

it("uses the current subscription price override on renewals and preserves earlier sales", async () => {
  const { t, sellerId, payment } = await setup("growth", true);
  await t.mutation(components.betterStripe.products.mutations.upsertProduct, {
    stripeProductId: "prod_store",
    accountId: "acct_store",
    name: "Membership",
    active: true,
  });
  await t.mutation(components.betterStripe.products.mutations.upsertPrice, {
    stripePriceId: "price_month",
    stripeProductId: "prod_store",
    productId: "product",
    currency: "usd",
    unitAmount: 10000,
    type: "recurring",
    interval: "month",
    active: true,
  });
  await t.mutation(api.sellerAffiliateRates.public.mutations.save, {
    sellerId,
    stripeProductId: "prod_store",
    affiliateBasisPoints: 1500,
    expectedVersion: 0,
  });
  await t.mutation(api.sellerAffiliateRates.public.mutations.save, {
    sellerId,
    stripeProductId: "prod_store",
    stripePriceId: "price_month",
    affiliateBasisPoints: 1250,
    expectedVersion: 0,
  });
  raw.subscriptions.retrieve.mockResolvedValue({
    metadata: { ...payment.metadata, stripePriceId: "price_old" },
    items: { data: [{ price: { id: "price_month" } }] },
  });
  raw.transfers.create.mockImplementation(async (args) => ({
    id: `tr_${args.source_transaction}_${args.destination}`,
    ...args,
  }));
  await runAction(t, internal.settlement.internal.actions.settle, {
    paymentIntentId: "pi_sale",
    subscriptionId: "sub_customer",
    invoiceId: "in_first",
  });
  const original = await t.query(
    internal.settlement.internal.queries.getByCharge,
    {
      chargeId: "ch_sale",
    },
  );
  expect(original).toMatchObject({
    affiliateBasisPoints: 1250,
    affiliateNet: 1188,
    sellerNet: 8322,
    affiliateRateSource: "price",
    stripePriceId: "price_month",
    stripeProductId: "prod_store",
  });
  await t.mutation(api.sellerAffiliateRates.public.mutations.save, {
    sellerId,
    stripeProductId: "prod_store",
    stripePriceId: "price_month",
    affiliateBasisPoints: 1000,
    expectedVersion: 1,
  });
  raw.paymentIntents.retrieve.mockResolvedValue({
    ...payment,
    id: "pi_next",
    latest_charge: { ...payment.latest_charge, id: "ch_next" },
  });
  await runAction(t, internal.settlement.internal.actions.settle, {
    paymentIntentId: "pi_next",
    subscriptionId: "sub_customer",
    invoiceId: "in_next",
  });
  expect(
    await t.query(internal.settlement.internal.queries.getByCharge, {
      chargeId: "ch_next",
    }),
  ).toMatchObject({
    affiliateBasisPoints: 1000,
    affiliateNet: 951,
    sellerNet: 8559,
  });
  await t.mutation(api.sellerAffiliateRates.public.mutations.save, {
    sellerId,
    stripeProductId: "prod_store",
    stripePriceId: "price_month",
    affiliateBasisPoints: null,
    affiliateFixedAmount: 12.29,
    expectedVersion: 2,
  });
  raw.paymentIntents.retrieve.mockResolvedValue({
    ...payment,
    id: "pi_fixed",
    latest_charge: { ...payment.latest_charge, id: "ch_fixed" },
  });
  await runAction(t, internal.settlement.internal.actions.settle, {
    paymentIntentId: "pi_fixed",
    subscriptionId: "sub_customer",
    invoiceId: "in_fixed",
  });
  expect(
    await t.query(internal.settlement.internal.queries.getByCharge, {
      chargeId: "ch_fixed",
    }),
  ).toMatchObject({
    affiliateFixedAmount: 12.29,
    affiliateNet: 1229,
    sellerNet: 8281,
    affiliateRateSource: "price",
  });
  expect(
    await t.query(internal.settlement.internal.queries.getByCharge, {
      chargeId: "ch_sale",
    }),
  ).toEqual(original);
});
