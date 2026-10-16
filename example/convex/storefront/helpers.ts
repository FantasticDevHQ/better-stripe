import { v } from "convex/values";

export const priceValidator = v.object({
  stripePriceId: v.string(),
  unitAmount: v.number(),
  currency: v.string(),
  type: v.string(),
  interval: v.optional(v.string()),
});
