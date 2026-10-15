import { defineTable } from "convex/server";
import { v } from "convex/values";
export const currencyTotalsTable = defineTable({
  accountId: v.string(),
  currency: v.string(),
  kind: v.union(v.literal("earnings"), v.literal("payouts")),
  gross: v.number(),
  reversed: v.number(),
  paidOut: v.number(),
  count: v.number(),
}).index("by_account_kind_currency", ["accountId", "kind", "currency"]);
