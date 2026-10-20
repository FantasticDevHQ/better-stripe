import { v } from "convex/values";

import { action, env } from "../_generated/server";

import { stripe } from "../stripe/helpers";

import {
  assertPriceOwner,
  assertTestModeStripeKey,
} from "../users/authorization";

export const createProduct = action({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    statementDescriptor: v.optional(v.union(v.string(), v.null())),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => stripe.createProduct(ctx, args),
});

export const createPrice = action({
  args: {
    stripeProductId: v.string(),
    unitAmount: v.number(),
    currency: v.string(),
    type: v.union(v.literal("one_time"), v.literal("recurring")),
    interval: v.optional(
      v.union(
        v.literal("month"),
        v.literal("year"),
        v.literal("week"),
        v.literal("day"),
      ),
    ),
  },
  handler: async (ctx, args) => stripe.createPrice(ctx, args),
});

export const updateProduct = action({
  args: {
    stripeProductId: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    statementDescriptor: v.optional(v.union(v.string(), v.null())),
    idempotencyKey: v.optional(v.string()),
  },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => stripe.updateProduct(ctx, args),
});

export const deactivateProduct = action({
  args: {
    stripeProductId: v.string(),
    idempotencyKey: v.optional(v.string()),
  },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => stripe.deactivateProduct(ctx, args),
});

// Archive a single price (BTS-88). Unlike `deactivateProduct` (a platform-admin
// operation with no binding), this carries an ownership assert: a price has no
// owner of its own, so `assertPriceOwner` verifies the caller owns the price's
// owning product's connected account (see authz.ts). It also makes a REAL
// Stripe API call, so it's gated on the test-mode key guard first — same
// order as `issueRefund`, so a live/misconfigured key is refused before any
// ownership lookup runs.
export const deactivatePrice = action({
  args: { userId: v.string(), stripePriceId: v.string() },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    await assertPriceOwner(ctx, args);
    return stripe.deactivatePrice(ctx, { stripePriceId: args.stripePriceId });
  },
});
