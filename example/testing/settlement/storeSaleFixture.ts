import { beforeEach, vi } from "vitest";
import "../../convex/settlement/internal/actions";
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { schema, modules } from "../../test";
import componentSchema from "../../../dist/component/schema.js";
import { components } from "../../convex/_generated/api";
import { componentsGeneric } from "convex/server";
import { mutation } from "../../../src/component/_generated/server";
import { v } from "convex/values";
const componentModules = import.meta.glob("../../../dist/component/**/*.js");

/** Existing settlement seed data; no provider action or invented original cash. */
export async function seedStoreSale(
  planId: "starter" | "growth" | "pro",
  referred: boolean,
  affiliateDebt = 0,
) {
  const t = convexTest(schema, modules);
  t.registerComponent("betterStripe", componentSchema, {
    ...componentModules,
    "../../../dist/component/affiliateFixture.js": async () => ({
      seed: mutation({
        args: { debt: v.number() },
        returns: v.null(),
        handler: async (ctx, args) => {
          // Retained synthetic historical-debt fixture; reserveEarning computes the real reduction.
          await ctx.db.insert("affiliateObligations", {
            sourceChargeId: "ch_old",
            affiliateAccountId: "acct_affiliate",
            currency: "usd",
            chargeAmount: 1000,
            originalCommission: args.debt,
            refundedPrincipal: 1000,
            disputedPrincipal: 0,
            lostPrincipal: 0,
            finalizedAmount: args.debt,
            provisionalAmount: 0,
            recoveredAmount: 0,
            needsReconciliation: false,
            debtAmount: args.debt,
            debtStatus: "open",
          });
          return null;
        },
      }),
    }),
  });
  if (affiliateDebt > 0)
    await t.mutation(componentsGeneric().betterStripe.affiliateFixture.seed, {
      debt: affiliateDebt,
    });
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
  return { t, sellerId };
}

const raw = vi.hoisted(() => ({
  charges: { retrieve: vi.fn() },
  paymentIntents: { retrieve: vi.fn() },
  subscriptions: { retrieve: vi.fn() },
  invoices: { list: vi.fn(), retrieve: vi.fn() },
  invoicePayments: { list: vi.fn() },
  transfers: { list: vi.fn(), create: vi.fn() },
}));
vi.mock("../../convex/stripe/client", () => ({ getStripeClient: () => raw }));
vi.mock("../../convex/stripe/helpers", async () => {
  const { getVerifiedSale } =
    await import("../../../src/client/settlement/verifiedSale");
  const { selectCommissionInvoice } =
    await import("../../../src/client/settlement/commissions");
  const { settleSale } =
    await import("../../../src/client/settlement/settleSale");
  const { components } = await import("../../convex/_generated/api");
  const sdk = raw as unknown as import("stripe").default;
  const { fixtureRecoveryClient } = await import("./providerFixture");
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
export async function setup(
  planId: "starter" | "growth" | "pro",
  referred = false,
  fee: number | null = 320,
  affiliateDebt = 0,
) {
  const { t, sellerId } = await seedStoreSale(planId, referred, affiliateDebt);
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

export function storeSaleRaw() {
  return raw;
}
