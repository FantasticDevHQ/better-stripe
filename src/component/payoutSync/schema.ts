import { defineTable } from "convex/server";
import { v } from "convex/values";
import { identity } from "./validators.js";
const fields = {
  ...identity,
  generation: v.number(),
  status: v.union(
    v.literal("pending"),
    v.literal("accepted"),
    v.literal("unknown"),
  ),
  startedAt: v.number(),
  acceptedGeneration: v.optional(v.number()),
  acceptedAt: v.optional(v.number()),
  acceptedFingerprint: v.optional(v.string()),
};
export const claimDoc = v.object({
  ...fields,
  _id: v.id("payoutSyncClaims"),
  _creationTime: v.number(),
});
/** Operational generations only. Financial facts remain in the existing payouts table. */
export const claimsTable = defineTable(fields).index("by_stripe_payout_id", [
  "stripePayoutId",
]);
