import { v } from "convex/values";

import { internalAction } from "../_generated/server";

import { stripe } from "../stripe/helpers";

/** Upper bound per run; a larger backlog drains over the following days. */
const MAX_BATCHES = 10;

/**
 * Daily webhook-ledger retention. Each batch is its own transaction and uses
 * the component defaults (30-day retention, 500 rows).
 */
export const prune = internalAction({
  args: {},
  returns: v.object({ deleted: v.number(), hasMore: v.boolean() }),
  handler: async (ctx): Promise<{ deleted: number; hasMore: boolean }> => {
    let deleted = 0;
    let hasMore = true;
    for (let batch = 0; batch < MAX_BATCHES && hasMore; batch++) {
      const result = await stripe.pruneWebhookEvents(ctx);
      deleted += result.deleted;
      hasMore = result.hasMore;
    }
    return { deleted, hasMore };
  },
});
