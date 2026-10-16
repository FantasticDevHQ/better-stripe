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
  const { CostRecoveryClient } =
    await import("../../../src/client/costRecovery");
  return {
    stripe: {
      costRecovery: new CostRecoveryClient(components.betterStripe, () => sdk),
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
  vi.resetAllMocks();
  raw.charges.retrieve.mockResolvedValue({ created: 1 });
  raw.transfers.list.mockResolvedValue({ data: [] });
  raw.transfers.create.mockImplementation(async (args) => ({
    id: `tr_${args.source_transaction}_${args.destination}`,
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
  ["one_time", 0],
  ["forever", 1820],
] as const)(
  "%s commission survives retries and pays the correct renewal",
  async (term, renewalCommission) => {
    const { t, sellerId, payment } = await setup("starter", true);
    raw.invoices.list.mockResolvedValue({
      data: [
        {
          id: "in_first",
          amount_paid: 10000,
          status_transitions: { paid_at: 1 },
        },
      ],
      has_more: false,
    });
    raw.subscriptions.retrieve.mockResolvedValue({
      metadata: { ...payment.metadata, affiliateCommissionTerm: term },
    });
    const settle = (invoiceId: string, paymentIntentId: string) =>
      t.action(internal.settlement.internal.actions.settle, {
        paymentIntentId,
        subscriptionId: "sub_term",
        invoiceId,
      });
    raw.paymentIntents.retrieve.mockResolvedValue({
      ...payment,
      status: "requires_payment_method",
    });
    await settle("in_first", "pi_sale");
    expect(raw.transfers.create).not.toHaveBeenCalled();
    raw.paymentIntents.retrieve.mockResolvedValue(payment);
    await settle("in_first", "pi_sale");
    await settle("in_first", "pi_sale");
    expect(
      (
        await t.query(internal.settlement.internal.queries.getByCharge, {
          chargeId: "ch_sale",
        })
      )?.affiliateNet,
    ).toBe(1820);
    raw.subscriptions.retrieve.mockResolvedValue({
      metadata: {
        ...payment.metadata,
        affiliateCommissionTerm: term === "one_time" ? "forever" : "one_time",
      },
    });
    raw.paymentIntents.retrieve.mockResolvedValue({
      ...payment,
      id: "pi_renewal",
      latest_charge: { ...payment.latest_charge, id: "ch_renewal" },
    });
    await settle("in_renewal", "pi_renewal");
    await settle("in_renewal", "pi_renewal");
    const sale = await t.query(
      internal.settlement.internal.queries.getByCharge,
      {
        chargeId: "ch_renewal",
      },
    );
    expect(sale).toMatchObject({
      affiliateNet: renewalCommission,
      sellerNet: 9100 - renewalCommission,
      affiliateCommissionTerm: term,
      stripeSubscriptionId: "sub_term",
    });
    expect(raw.transfers.create).toHaveBeenCalledTimes(
      term === "one_time" ? 3 : 4,
    );
    expect(raw.invoices.list).toHaveBeenCalledTimes(
      term === "one_time" ? 1 : 0,
    );
    expect(
      await t.query(api.settlement.public.queries.listSellerSales, {
        sellerId,
      }),
    ).toHaveLength(2);
  },
);

it("does not give a delayed renewal the one-time commission before the first invoice webhook arrives", async () => {
  const { t, payment } = await setup("starter", true);
  raw.subscriptions.retrieve.mockResolvedValue({
    metadata: { ...payment.metadata, affiliateCommissionTerm: "one_time" },
  });
  raw.invoices.list.mockResolvedValue({
    data: [
      {
        id: "in_renewal",
        amount_paid: 10000,
        status_transitions: { paid_at: 2 },
      },
      {
        id: "in_first",
        amount_paid: 10000,
        status_transitions: { paid_at: 1 },
      },
      { id: "in_trial", amount_paid: 0, status_transitions: { paid_at: 0 } },
    ],
    has_more: false,
  });
  await t.action(internal.settlement.internal.actions.settle, {
    paymentIntentId: "pi_sale",
    subscriptionId: "sub_delayed",
    invoiceId: "in_renewal",
  });
  expect(
    (
      await t.query(internal.settlement.internal.queries.getByCharge, {
        chargeId: "ch_sale",
      })
    )?.affiliateNet,
  ).toBe(0);
  raw.paymentIntents.retrieve.mockResolvedValue({
    ...payment,
    id: "pi_first",
    latest_charge: { ...payment.latest_charge, id: "ch_first" },
  });
  await t.action(internal.settlement.internal.actions.settle, {
    paymentIntentId: "pi_first",
    subscriptionId: "sub_delayed",
    invoiceId: "in_first",
  });
  expect(
    (
      await t.query(internal.settlement.internal.queries.getByCharge, {
        chargeId: "ch_first",
      })
    )?.affiliateNet,
  ).toBe(1820);
});
