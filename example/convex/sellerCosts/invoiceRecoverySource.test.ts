import { runAction } from "../settlement/workflow/providerFixture.testHelpers";
import { anyApi } from "convex/server";
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
  paymentIntents: { retrieve: vi.fn() },
  invoices: { retrieve: vi.fn(), listLineItems: vi.fn() },
  invoiceItems: { list: vi.fn(), create: vi.fn() },
  invoicePayments: { list: vi.fn() },
  subscriptions: { retrieve: vi.fn() },
}));
vi.mock("../stripe/client", () => ({ getStripeClient: () => raw }));
const client = vi.hoisted(() => ({
  getProcessingCostContext: vi.fn(),
  getPriceByStripeId: vi.fn(),
  getProductByStripeId: vi.fn(),
}));
vi.mock("../stripe/helpers", async () => {
  const { fixtureRecoveryClient } =
    await import("../settlement/workflow/providerFixture.testHelpers");
  const { components } = await import("../_generated/api");
  return {
    stripe: {
      ...client,
      costRecovery: fixtureRecoveryClient(
        components.betterStripe,
        raw as unknown as import("stripe").default,
        client.getProcessingCostContext,
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
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  raw.paymentIntents.retrieve.mockImplementation(async (id) => ({
    id,
    customer_account: "acct_buyer",
  }));
});
async function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent(
    "betterStripe",
    componentSchema,
    import.meta.glob("../../../dist/component/**/*.js"),
  );
  workflowTest.register(t, "betterStripe/workflow");
  for (const [product, prices] of [
    ["prod_default", ["price_default"]],
    ["prod_store", ["price_store", "price_original"]],
  ] as const) {
    await t.mutation(components.betterStripe.products.mutations.upsertProduct, {
      stripeProductId: product,
      accountId: "acct_store",
      name: "Original",
      active: false,
    });
    for (const price of prices)
      await t.mutation(components.betterStripe.products.mutations.upsertPrice, {
        stripePriceId: price,
        stripeProductId: product,
        productId: "fixture",
        unitAmount: 10000,
        currency: "usd",
        type: "one_time",
        active: false,
      });
  }
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
  await runAction(t, internal.sellerCosts.actions.reconcile, {
    paymentIntentId: "pi_sale",
  });
  await runAction(t, internal.sellerCosts.actions.attachToInvoice, {
    sellerId,
    invoiceId: "in_monthly",
  });
  raw.invoices.retrieve.mockResolvedValue({
    id: "in_monthly",
    customer_account: "acct_store",
    currency: "usd",
    status: "paid",
  });
  await runAction(t, internal.sellerCosts.recoveryInvoices.actions.reconcile, {
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
  const { stripe } = await import("../stripe/helpers");
  const observe = vi
    .spyOn(stripe.costRecovery, "observeProcessingCosts")
    .mockImplementation(async (_ctx, request) => ({
      ...request,
      outcome: {
        status: "rejected",
        reason: "unsupported_source",
        retryable: false,
      },
    }));
  try {
    await runAction(t, internal.sellerCosts.actions.reconcileWhenReady, {
      paymentIntentId: "pi_funding",
    });
    expect(
      await t.query(anyApi.sellerCosts.workflow.queries.list, { sellerId }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "cost",
          sourceId: "ch_funding",
          status: "rejected",
          reason: "unsupported_source",
        }),
      ]),
    );
    expect(
      await t.query(components.betterStripe.costRecovery.queries.claim, {
        claimKey: "example:cost:pi_funding",
      }),
    ).toBeNull();
    expect(observe).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accountId: "acct_store",
        scopeKey: `example:store:${sellerId}`,
        currency: "usd",
      }),
      expect.anything(),
    );
  } finally {
    observe.mockRestore();
  }
});
it("reinstates refunded invoice-funded recovery and passes uncovered processing fees to the seller", async () => {
  const { t, sellerId } = await setup();
  await runAction(t, internal.sellerCosts.actions.reconcile, {
    paymentIntentId: "pi_sale",
  });
  await runAction(t, internal.sellerCosts.actions.attachToInvoice, {
    sellerId,
    invoiceId: "in_monthly",
  });
  raw.invoices.retrieve.mockResolvedValue({
    id: "in_monthly",
    customer_account: "acct_store",
    currency: "usd",
    status: "paid",
  });
  await runAction(t, internal.sellerCosts.recoveryInvoices.actions.reconcile, {
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
  const { stripe } = await import("../stripe/helpers");
  const { components } = await import("../_generated/api");
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
    await runAction(t, internal.sellerCosts.actions.reconcile, {
      paymentIntentId: "pi_funding",
    });
    expect(
      (
        await t.query(api.sellerCosts.billing.public.queries.list, { sellerId })
      ).find((row) => row.paymentIntentId === "pi_funding"),
    ).toMatchObject({ amountDue: 160, processingLoss: 0, outstanding: 160 });
    returned = 1220;
    await runAction(t, internal.sellerCosts.actions.reconcile, {
      paymentIntentId: "pi_funding",
    });
    await runAction(t, internal.sellerCosts.actions.reconcile, {
      paymentIntentId: "pi_funding",
    });
    expect(
      (
        await t.query(api.sellerCosts.billing.public.queries.list, { sellerId })
      ).find((row) => row.paymentIntentId === "pi_funding"),
    ).toMatchObject({ amountDue: 385, processingLoss: 65, outstanding: 385 });
  } finally {
    rollback.mockRestore();
  }
});
