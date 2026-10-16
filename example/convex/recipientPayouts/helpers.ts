import { v } from "convex/values";

export const payout = v.object({
  id: v.string(),
  amount: v.number(),
  currency: v.string(),
  status: v.string(),
  arrivalDate: v.union(v.number(), v.null()),
  created: v.number(),
});

export const fields = {
  status: v.union(v.literal("ready"), v.literal("not_ready")),
  reason: v.optional(v.string()),
  upcomingComplete: v.boolean(),
  balances: v.array(
    v.object({
      currency: v.string(),
      available: v.number(),
      pending: v.number(),
    }),
  ),
  payouts: v.array(payout),
  upcoming: v.array(payout),
  nextCursor: v.union(v.string(), v.null()),
};

export const resultValidator = v.object(fields);
