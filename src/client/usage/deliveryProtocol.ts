import { v } from "convex/values";
/** Register only as a host internal action. Never accept provider options from a browser. */
export const usageDeliveryArgs = {
  scope: v.object({
    stripeAccountId: v.string(),
    customerAccount: v.string(),
    meterId: v.string(),
    livemode: v.boolean(),
  }),
  eventId: v.string(),
  attempt: v.number(),
  definitionVersion: v.literal(1),
  apiVersion: v.string(),
  identifier: v.string(),
};
export const usageDeliveryOutcomeValidator = v.union(
  v.object({ status: v.literal("accepted"), created: v.number() }),
  v.object({ status: v.literal("rate_limited") }),
  v.object({ status: v.literal("unavailable") }),
  v.object({ status: v.literal("unknown") }),
  v.object({ status: v.literal("rejected") }),
);
export const usageDeliveryResult = v.object({
  ...usageDeliveryArgs,
  outcome: usageDeliveryOutcomeValidator,
});
