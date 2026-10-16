import { v } from "convex/values";

import { query } from "../_generated/server";

import { stripe } from "../stripe/helpers";
import {
  DEMO_FEE_PERCENT,
  demoContextValidator,
  destinationChargeDemoContextValidator,
  reconciles,
  saleBreakdown,
} from "./model";

/**
 * Resolve everything the demo needs from the BTS-41 seed: the buyer (Billie),
 * the store seller (Maya's Fitness Studio) with her connected account, and that
 * store's monthly recurring price. Returns `null` until the marketplace seed has
 * run and linked accounts + catalog (so the demo pages can show a "seed first"
 * state instead of crashing).
 */
export const getMarketplaceDemoContext = query({
  args: {},
  returns: demoContextValidator,
  handler: async (ctx) => {
    const buyer = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", "billie@example.com"))
      .first();
    const seller = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", "maya@example.com"))
      .first();
    if (!buyer || !seller?.stripeAccountId) return null;

    const products = await stripe.listProducts(ctx, {
      accountId: seller.stripeAccountId,
    });
    for (const product of products) {
      const prices = await stripe.listPricesByProduct(ctx, {
        stripeProductId: product.stripeProductId,
      });
      const monthly = prices.find(
        (p) => p.type === "recurring" && p.interval === "month",
      );
      if (monthly) {
        return {
          buyer: { id: buyer._id, name: buyer.name, email: buyer.email },
          store: {
            sellerId: seller._id,
            name: seller.name,
            storeName: seller.storeName ?? seller.name,
            stripeAccountId: seller.stripeAccountId,
          },
          price: {
            stripePriceId: monthly.stripePriceId,
            unitAmount: monthly.unitAmount ?? 0,
            currency: monthly.currency,
            interval: monthly.interval ?? undefined,
          },
          feePercent: DEMO_FEE_PERCENT,
        };
      }
    }
    return null;
  },
});

/**
 * BTS-58 — resolve everything the single-recipient destination-charge +
 * platform-fee demo needs from the BTS-41 seed: the buyer (Billie), the store
 * seller (Sasha's Ceramics) with her connected account, and that store's
 * one-time price. Unlike {@link getMarketplaceDemoContext} (BTS-42, Maya's
 * recurring plan), this targets a *one-time* price so the sale is a plain
 * `mode: "payment"` destination charge — the fee/payout split is computed up
 * front from the known price (`saleBreakdown`), since a fixed one-time price
 * has no proration to make the eventual charge amount uncertain. Returns
 * `null` until the marketplace seed has linked accounts + catalog.
 */
export const getDestinationChargeDemoContext = query({
  args: {},
  returns: destinationChargeDemoContextValidator,
  handler: async (ctx) => {
    const buyer = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", "billie@example.com"))
      .first();
    const seller = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", "sasha@example.com"))
      .first();
    if (!buyer || !seller?.stripeAccountId) return null;

    const products = await stripe.listProducts(ctx, {
      accountId: seller.stripeAccountId,
    });
    for (const product of products) {
      const prices = await stripe.listPricesByProduct(ctx, {
        stripeProductId: product.stripeProductId,
      });
      const oneTime = prices.find((p) => p.type === "one_time");
      if (oneTime) {
        const unitAmount = oneTime.unitAmount ?? 0;
        const breakdown = saleBreakdown(unitAmount, DEMO_FEE_PERCENT);
        return {
          buyer: { id: buyer._id, name: buyer.name, email: buyer.email },
          store: {
            sellerId: seller._id,
            name: seller.name,
            storeName: seller.storeName ?? seller.name,
            stripeAccountId: seller.stripeAccountId,
          },
          price: {
            stripePriceId: oneTime.stripePriceId,
            unitAmount,
            currency: oneTime.currency,
          },
          feePercent: DEMO_FEE_PERCENT,
          breakdown: { ...breakdown, reconciles: reconciles(breakdown) },
        };
      }
    }
    return null;
  },
});

/** The store's payout rows (Connect `listPayouts`, scoped to the recipient account). */
export const listStorePayouts = query({
  args: { stripeAccountId: v.string() },
  handler: async (ctx, args) =>
    stripe.listPayouts(ctx, { stripeAccountId: args.stripeAccountId }),
});

/**
 * The buyer's latest paid invoice for the store subscription, plus the platform
 * fee split for it. This is the "resulting invoice" the destination charge
 * produced; `saleBreakdown` derives the 10% application fee from the recorded
 * `amountPaid` (the component doesn't denormalize `application_fee_amount` onto
 * the invoice row for the percent path, so the fee is computed from the applied
 * rate — the same value Stripe took).
 */
export const getLatestStoreInvoice = query({
  args: { userId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      stripeInvoiceId: v.string(),
      gross: v.number(),
      fee: v.number(),
      net: v.number(),
      currency: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const invoices = await stripe.listInvoices(ctx, { userId: args.userId });
    const paid = invoices
      .filter((i) => i.status === "paid" && i.amountPaid > 0)
      .sort((a, b) => b._creationTime - a._creationTime);
    const latest = paid[0];
    if (!latest) return null;
    const { gross, fee, net } = saleBreakdown(
      latest.amountPaid,
      DEMO_FEE_PERCENT,
    );
    return {
      stripeInvoiceId: latest.stripeInvoiceId,
      gross,
      fee,
      net,
      currency: latest.currency,
    };
  },
});
