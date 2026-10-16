import { defineTable } from "convex/server";
import { v } from "convex/values";
import { appliedConfigurationsValidator } from "../core/validators.js";

export const closureFields = {
  stripeAccountId: v.string(),
  userId: v.optional(v.string()),
  orgId: v.optional(v.string()),
  appliedConfigurations: appliedConfigurationsValidator,
  state: v.union(v.literal("pending"), v.literal("closed")),
  closedAt: v.optional(v.number()),
};
export const closureDoc = v.object({
  _id: v.id("accountClosures"),
  _creationTime: v.number(),
  ...closureFields,
});
export const accountClosuresTable = defineTable(closureFields)
  .index("by_stripe_account_id", ["stripeAccountId"])
  .index("by_user_state", ["userId", "orgId", "state"]);
