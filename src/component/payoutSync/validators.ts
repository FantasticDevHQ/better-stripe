import { v } from "convex/values";
import { payoutFields, payoutDocValidator } from "../connect/validators.js";
export const identity = { stripePayoutId: v.string(), accountId: v.string() };
export const snapshot = v.object({
  ...payoutFields,
  metadata: v.optional(v.record(v.string(), v.string())),
});
export const prepared = {
  ...identity,
  generation: v.number(),
  payout: snapshot,
};
export const result = v.union(
  v.object({
    status: v.literal("accepted"),
    generation: v.number(),
    changed: v.boolean(),
    payout: payoutDocValidator,
  }),
  v.object({ status: v.literal("superseded"), generation: v.number() }),
);
