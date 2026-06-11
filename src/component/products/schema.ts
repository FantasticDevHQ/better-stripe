import { defineTable } from "convex/server";

import { priceFields, productFields } from "./validators";

/**
 * Products synced from Stripe.
 */
export const productsTable = defineTable(productFields)
  .index("by_stripe_product_id", ["stripeProductId"])
  .index("by_account_id", ["accountId"]);

/**
 * Prices linked to products.
 */
export const pricesTable = defineTable(priceFields)
  .index("by_stripe_price_id", ["stripePriceId"])
  .index("by_product_id", ["productId"])
  .index("by_stripe_product_id", ["stripeProductId"]);
