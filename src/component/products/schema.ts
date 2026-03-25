import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { priceIntervalValidator, priceTypeValidator } from './validators';

/**
 * Products synced from Stripe.
 */
export const productsTable = defineTable({
  stripeProductId: v.string(),
  accountId: v.optional(v.string()),
  name: v.string(),
  description: v.optional(v.string()),
  active: v.boolean(),
  metadata: v.optional(v.any()),
})
  .index('by_stripe_product_id', ['stripeProductId'])
  .index('by_account_id', ['accountId']);

/**
 * Prices linked to products.
 */
export const pricesTable = defineTable({
  stripePriceId: v.string(),
  productId: v.string(),
  stripeProductId: v.string(),
  nickname: v.optional(v.string()),
  unitAmount: v.number(),
  currency: v.string(),
  active: v.boolean(),
  type: priceTypeValidator,
  interval: priceIntervalValidator,
  intervalCount: v.optional(v.number()),
  metadata: v.optional(v.any()),
})
  .index('by_stripe_price_id', ['stripePriceId'])
  .index('by_product_id', ['productId'])
  .index('by_stripe_product_id', ['stripeProductId']);
