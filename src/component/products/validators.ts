import { type Infer, v } from "convex/values";

export const priceTypeValidator = v.union(
  v.literal("one_time"),
  v.literal("recurring"),
);
export type PriceType = Infer<typeof priceTypeValidator>;

export const priceIntervalValidator = v.optional(
  v.union(
    v.literal("day"),
    v.literal("week"),
    v.literal("month"),
    v.literal("year"),
  ),
);

/**
 * Field validators for the `products` table.
 * Shared between the schema definition and the doc validator so the
 * two can never drift apart.
 */
export const productFields = {
  stripeProductId: v.string(),
  accountId: v.optional(v.string()),
  name: v.string(),
  description: v.optional(v.string()),
  active: v.boolean(),
  metadata: v.optional(v.any()),
};

/** Full `products` document, including system fields. */
export const productDocValidator = v.object({
  _id: v.id("products"),
  _creationTime: v.number(),
  ...productFields,
});

/**
 * Field validators for the `prices` table.
 * Shared between the schema definition and the doc validator so the
 * two can never drift apart.
 */
export const priceFields = {
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
};

/** Full `prices` document, including system fields. */
export const priceDocValidator = v.object({
  _id: v.id("prices"),
  _creationTime: v.number(),
  ...priceFields,
});
