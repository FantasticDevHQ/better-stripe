import { defineTable } from "convex/server";

import { webhookEventFields } from "./validators";

/**
 * Internal-only ledger for webhook replay protection and observability.
 */
export const webhookEventsTable = defineTable(webhookEventFields)
  .index("by_stripeEventId", ["stripeEventId"])
  .index("by_status", ["status"]);
