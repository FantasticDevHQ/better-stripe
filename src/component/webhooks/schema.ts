import { defineTable } from "convex/server";

import { webhookEventFields } from "./validators";

/**
 * Internal-only ledger for webhook replay protection and observability.
 */
export const webhookEventsTable = defineTable(webhookEventFields)
  .index("by_stripeEventId", ["stripeEventId"])
  // Status prefix + ledger time: serves status lookups and retention pruning.
  .index("by_status_processedAt", ["status", "processedAt"]);
