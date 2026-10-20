import { beforeEach, expect, it, vi } from "vitest";
import { mixed } from "../../../src/client/usage/mixedInvoice.fixtures";
import { getUsageInvoiceSale } from "../../../src/client/usage/invoiceSale";
import type { ActionCtx } from "../_generated/server";
import { meteredSaleSource } from "./settlementSource";
const state = vi.hoisted(() => ({
  raw: null as unknown,
  owner: "acct_seller",
}));
vi.mock("../stripe/client", () => ({ getStripeClient: () => state.raw }));
vi.mock("../stripe/helpers", () => ({
  stripe: {
    getAccountByStripeId: async () => ({ userId: "buyer" }),
    getProductIdentity: async () => ({
      status: "unique",
      product: { accountId: state.owner },
    }),
    usage: {
      getInvoiceSale: async (
        _ctx: unknown,
        input: Parameters<typeof getUsageInvoiceSale>[1],
      ) =>
        getUsageInvoiceSale(
          state.raw as Parameters<typeof getUsageInvoiceSale>[0],
          input,
        ),
    },
  },
}));
beforeEach(() => {
  state.owner = "acct_seller";
});
function setup() {
  state.owner = "acct_seller";
  const f = mixed();
  state.raw = f.sdk;
  Object.assign(f.subscription.metadata, { bsUsageIntent: "a".repeat(64) });
  const checkout = {
    id: "cs_original",
    status: "complete",
    subscription: "sub_source",
    customer_account: "acct_customer",
    livemode: false,
  };
  f.extra.set("/v1/checkout/sessions/cs_original", checkout);
  const view = {
    subscriptionId: "sub_source",
    bindings: [{ ...f.input }],
    items: [{ id: "si_base", stripePriceId: "price_base" }],
  };
  const row = {
    _id: "enrollment",
    buyerId: "buyer",
    offerId: "offer",
    payerJson: JSON.stringify({
      accountId: "acct_customer",
      customerId: "cus_buyer",
    }),
    checkoutJson: JSON.stringify({ id: "cs_original" }),
    providerJson: JSON.stringify(view),
    settlementPlanId: "starter",
  };
  const offer = {
    ownerId: "seller",
    productId: "prod_original",
    baseAmount: 2000,
    providerJson: JSON.stringify({
      issuer: "acct_platform",
      price: { stripePriceId: "price_original", meterId: "mtr_calls" },
      configuration: { plan: f.input.binding.plan },
      basePriceId: "price_base",
    }),
  };
  const intent = {
    key: "a".repeat(64),
    providerId: "sub_source",
    checkoutId: "cs_original",
  };
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.checkoutId || args.enrollmentId) return row;
      if (args.offerId) return offer;
      if (args.actorId === "buyer")
        return {
          id: "buyer",
          role: "customer",
          stripeAccountId: "acct_customer",
        };
      if (args.actorId)
        return { id: "seller", role: "seller", stripeAccountId: "acct_seller" };
      return intent;
    },
  } as unknown as ActionCtx;
  return { ...f, checkout, row, offer, intent, ctx };
}
it("routes original mixed cash through its Checkout/enrollment and ignores metadata seller claims", async () => {
  const f = setup();
  Object.assign(f.subscription.metadata, { sellerId: "attacker" });
  const result = await meteredSaleSource(f.ctx, {
    paymentIntentId: "pi_source",
    invoiceId: "in_source",
    subscriptionId: "sub_source",
  });
  expect(result?.verified).toMatchObject({
    gross: 3000,
    processingFee: 120,
    chargeId: "ch_source",
    metadata: { sellerId: "seller", userId: "buyer", planId: "starter" },
  });
  expect(result?.usageSource.invoiceLines).toHaveLength(2);
});
it("holds changed original Checkout, native funding, managed intent and seller ownership", async () => {
  for (const change of [
    "checkout",
    "intent",
    "owner",
    "payer",
    "foreign_item",
    "offer_product",
    "offer_price",
  ]) {
    const f = setup();
    if (change === "offer_product") f.offer.productId = "prod_other_owned";
    if (change === "offer_price") {
      const provider = JSON.parse(f.offer.providerJson);
      provider.price.stripePriceId = "price_other";
      f.offer.providerJson = JSON.stringify(provider);
    }
    if (change === "checkout") f.checkout.subscription = "sub_foreign";
    if (change === "intent") f.intent.providerId = "sub_foreign";
    if (change === "owner") state.owner = "acct_foreign";
    if (change === "payer") f.invoice.customer_account = "acct_foreign";
    if (change === "foreign_item")
      f.base.parent.subscription_item_details.subscription_item = "si_foreign";
    await expect(
      meteredSaleSource(f.ctx, {
        paymentIntentId: "pi_source",
        invoiceId: "in_source",
        subscriptionId: "sub_source",
      }),
      change,
    ).rejects.toThrow();
  }
});
