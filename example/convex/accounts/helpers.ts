import { v } from "convex/values";

import type { StripeComponentAccount } from "@fantastic.dev/better-stripe";

import { components } from "../_generated/api";

import { type QueryCtx } from "../_generated/server";

import { stripe } from "../stripe/helpers";

// `stripe.listTransfersByCharge` resolves through the untyped `componentRef`
// helper (returns `Promise<any>`), so this narrows the shape actually
// returned by the component's `transferDocValidator` for the fields used here.
export type TransferLedgerRow = {
  stripeTransferId: string;
  amount: number;
  reversedAmount?: number;
};

// Accounts
export async function getPersonaAccount(
  ctx: QueryCtx,
  userId: string,
): Promise<StripeComponentAccount | null> {
  if (!userId) return null;
  const id = ctx.db.normalizeId("users", userId);
  const user = id ? await ctx.db.get("users", id) : null;
  return user?.stripeAccountId
    ? stripe.getAccountByStripeId(ctx, {
        stripeAccountId: user.stripeAccountId,
      })
    : stripe.getAccountByUserId(ctx, { userId });
}

// Refunds & reversals (BTS-80)
export const connectQueries = components.betterStripe.connect.queries;

export const affiliateSaleValidator = v.object({
  stripeTransferId: v.string(),
  sourceChargeId: v.optional(v.string()),
  storeName: v.union(v.string(), v.null()),
  amount: v.number(),
  currency: v.string(),
});

export async function affiliateSale(
  ctx: QueryCtx,
  accountId: string,
  transfer: {
    stripeTransferId: string;
    sourceChargeId?: string;
    amount: number;
    reversedAmount?: number;
    currency: string;
  },
) {
  let seller = null;
  if (transfer.sourceChargeId) {
    const sale = await ctx.db
      .query("storeSales")
      .withIndex("by_charge", (q) => q.eq("chargeId", transfer.sourceChargeId!))
      .first();
    if (sale?.affiliateAccountId === accountId)
      seller = await ctx.db.get("users", sale.sellerId);
    if (!seller) {
      const legs = await ctx.runQuery(
        components.betterStripe.connect.queries.listTransfersByCharge,
        { sourceChargeId: transfer.sourceChargeId, limit: 10 },
      );
      const store = legs.find((leg) => leg.role === "store");
      if (store)
        seller = await ctx.db
          .query("users")
          .withIndex("by_stripe_account", (q) =>
            q.eq("stripeAccountId", store.destinationAccountId),
          )
          .first();
    }
  }
  return {
    stripeTransferId: transfer.stripeTransferId,
    sourceChargeId: transfer.sourceChargeId,
    storeName:
      seller?.role === "seller" ? (seller.storeName ?? seller.name) : null,
    amount: transfer.amount - (transfer.reversedAmount ?? 0),
    currency: transfer.currency,
  };
}
