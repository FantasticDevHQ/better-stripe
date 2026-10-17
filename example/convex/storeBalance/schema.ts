import { defineTable } from "convex/server";
import { v } from "convex/values";
import { fields, migrationLink } from "./funding/helpers";
import { runFields } from "./backfill/validators";
import { requestFields } from "./workflow/validators";
export const storeBalanceTables = {
  storeBalanceMigrationRuns: defineTable(runFields).index("by_key", ["key"]),
  // Host consent/intent references only. The component owns financial execution.
  storeBalanceRequests: defineTable(requestFields).index(
    "by_seller_subscription",
    ["sellerId", "subscriptionId"],
  ),
  storeBalanceFunding: defineTable({
    ...fields,
    migrationPaused: v.optional(v.boolean()),
    componentMigration: v.optional(migrationLink),
  }).index("by_seller", ["sellerId"]),
};
