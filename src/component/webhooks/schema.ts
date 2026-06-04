import { defineTable } from "convex/server";
import { v } from "convex/values";

import { webhookEventStatusValidator } from "./validators";

/**
 * Internal-only ledger for webhook replay protection and observability.
 */
export const webhookEventsTable = defineTable({
  stripeEventId: v.string(),
  eventType: v.string(),
  livemode: v.optional(v.boolean()),
  processedAt: v.number(),
  status: webhookEventStatusValidator,
  lastError: v.optional(v.string()),
})
  .index("by_stripeEventId", ["stripeEventId"])
  .index("by_status", ["status"]);
