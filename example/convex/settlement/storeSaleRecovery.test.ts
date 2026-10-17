import { runAction } from "./workflow/providerFixture.testHelpers";
import { anyApi } from "convex/server";
import workflowTest from "@convex-dev/workflow/test";
import { modules } from "../../test";
// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, expect, it, vi } from "vitest";
import componentSchema from "../../../dist/component/schema.js";
import { components, internal } from "../_generated/api";
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
    await import("./workflow/providerFixture.testHelpers");
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
it("keeps interrupted recovery held and collects once after positive provider reconciliation", async () => {
  const { t, sellerId } = await setup("growth", true);
  await t.mutation(internal.sellerCosts.billing.internal.mutations.record, {
    sellerId,
    sourceChargeId: "ch_cost",
    paymentIntentId: "pi_cost",
    currency: "usd",
    amountDue: 320,
    processingLoss: 320,
    disputeFees: 0,
    observedAt: 1,
    sourceGross: 10000,
    sourceProcessingFee: 320,
    expectedRevision: -1,
  });
  let fail = true;
  raw.transfers.create.mockImplementation(async (args) => {
    if (args.destination === "acct_affiliate" && fail) {
      fail = false;
      throw Error("affiliate transfer interrupted");
    }
    return { id: `tr_${args.destination}`, ...args };
  });
  await runAction(t, internal.settlement.internal.actions.settle, {
    paymentIntentId: "pi_sale",
  });
  expect(
    await t.query(anyApi.sellerCosts.workflow.queries.list, { sellerId }),
  ).toMatchObject([{ kind: "settlement", status: "unknown" }]);
  expect(
    await t.query(components.betterStripe.costRecovery.queries.balance, {
      accountId: "acct_store",
      scopeKey: `example:store:${sellerId}`,
      currency: "usd",
    }),
  ).toMatchObject({ reservedAmount: 320, collectedAmount: 0 });
  const sale = await t.query(internal.settlement.internal.queries.getByCharge, {
    chargeId: "ch_sale",
  });
  raw.transfers.list.mockResolvedValue({
    data: [
      {
        id: "tr_acct_store",
        destination: "acct_store",
        amount: sale!.sellerNet,
        currency: "usd",
        source_transaction: "ch_sale",
        metadata: { bsSourceCharge: "ch_sale", bsRole: "store" },
      },
      {
        id: "tr_acct_affiliate",
        destination: "acct_affiliate",
        amount: sale!.affiliateNet,
        currency: "usd",
        source_transaction: "ch_sale",
        metadata: { bsSourceCharge: "ch_sale", bsRole: "affiliate" },
      },
    ],
    has_more: false,
  });
  await runAction(t, internal.settlement.internal.actions.settle, {
    paymentIntentId: "pi_sale",
  });
  await runAction(t, internal.settlement.internal.actions.settle, {
    paymentIntentId: "pi_sale",
  });
  expect(
    raw.transfers.create.mock.calls.filter(
      ([args]) => args.destination === "acct_store",
    ),
  ).toHaveLength(1);
  expect(
    await t.query(components.betterStripe.costRecovery.queries.balance, {
      accountId: "acct_store",
      scopeKey: `example:store:${sellerId}`,
      currency: "usd",
    }),
  ).toMatchObject({ reservedAmount: 0, collectedAmount: 320, outstanding: 0 });
});
