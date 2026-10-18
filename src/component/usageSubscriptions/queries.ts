import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import schema from "../schema.js";
import { validateUsagePageRequest } from "../../client/usage/boundaries.js";
import { historyDoc } from "./schema.js";
import { v } from "convex/values";
import { query } from "../_generated/server.js";
import { intentDoc } from "./schema.js";
import { intentKey } from "./helpers.js";
export const scope = v.object({
  stripeAccountId: v.string(),
  customerAccount: v.string(),
  livemode: v.boolean(),
});
export const get = query({
  args: { scope, requestId: v.string() },
  returns: v.union(intentDoc, v.null()),
  handler: async (ctx, args) => {
    const key = await intentKey(args.scope, args.requestId);
    return ctx.db
      .query("usageSubscriptionIntents")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
  },
});

export const lookup = query({
  args: { key: v.string() },
  returns: v.union(intentDoc, v.null()),
  handler: async (ctx, args) => {
    if (!/^[a-f0-9]{64}$/.test(args.key))
      throw new Error("Invalid managed subscription key");
    return ctx.db
      .query("usageSubscriptionIntents")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
  },
});
export const history = query({
  args: {
    scope,
    requestId: v.string(),
    kind: v.union(
      v.literal("subscription"),
      v.literal("invoice"),
      v.literal("retirement"),
    ),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(historyDoc),
  handler: async (ctx, args) => {
    validateUsagePageRequest({
      period: { start: 0, end: 1 },
      limit: args.paginationOpts.numItems,
      cursor: args.paginationOpts.cursor,
    });
    const key = await intentKey(args.scope, args.requestId);
    const intent = await ctx.db
      .query("usageSubscriptionIntents")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (!intent) throw new Error("Managed subscription scope unavailable");
    return paginator(ctx.db, schema)
      .query("usageSubscriptionHistory")
      .withIndex("by_intent_kind", (q) =>
        q.eq("intentKey", key).eq("kind", args.kind),
      )
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        maximumRowsRead: 200,
        maximumBytesRead: 1000000,
      });
  },
});
