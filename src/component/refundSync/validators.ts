import { v } from "convex/values";
import { refundFields, refundDocValidator } from "../connect/validators.js";

export const identity = { stripeRefundId: v.string(), apiContext: v.string() };
export const snapshot = v.object({
  ...refundFields,
  stripePaymentIntentId: v.string(),
  stripeChargeId: v.string(),
  metadata: v.optional(v.record(v.string(), v.string())),
});
export const prepared = {
  ...identity,
  generation: v.number(),
  refund: snapshot,
};
export const result = v.union(
  v.object({
    status: v.literal("accepted"),
    generation: v.number(),
    changed: v.boolean(),
    refund: refundDocValidator,
  }),
  v.object({ status: v.literal("superseded"), generation: v.number() }),
);
export const routingInput = {
  stripeRefundId: v.string(),
  stripePaymentIntentId: v.string(),
  stripeChargeId: v.string(),
  currency: v.string(),
};
export const routingResult = v.object({
  status: v.union(v.literal("known"), v.literal("unknown"), v.literal("held")),
  merchantAccount: v.union(v.string(), v.null()),
  requiresChargeProof: v.boolean(),
});
