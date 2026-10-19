import { v } from "convex/values";

import { paginationOptsValidator } from "convex/server";

import { query } from "../_generated/server";

import { stripe } from "../stripe/helpers";

// Demo bindings only. Production adapters derive authorized account/product
// scope from the authenticated user before calling these package methods.
export const paginateProducts = query({
  args: {
    accountId: v.optional(v.string()),
    active: v.optional(v.boolean()),
    paginationOpts: paginationOptsValidator,
  },
  handler: (ctx, args) => stripe.paginateProducts(ctx, args),
});

export const paginatePrices = query({
  args: {
    productId: v.optional(v.string()),
    stripeProductId: v.optional(v.string()),
    active: v.optional(v.boolean()),
    paginationOpts: paginationOptsValidator,
  },
  handler: (ctx, args) => stripe.paginatePrices(ctx, args),
});

export const paginatePayouts = query({
  args: { accountId: v.string(), paginationOpts: paginationOptsValidator },
  handler: (ctx, args) => stripe.paginatePayouts(ctx, args),
});

export const getAccountEarningsByCurrency = query({
  args: { destinationAccountId: v.string() },
  handler: (ctx, args) => stripe.getAccountEarningsByCurrency(ctx, args),
});

export const getAccountPayoutsByCurrency = query({
  args: { accountId: v.string() },
  handler: (ctx, args) => stripe.getAccountPayoutsByCurrency(ctx, args),
});
