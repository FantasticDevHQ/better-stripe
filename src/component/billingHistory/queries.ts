import { paginator } from "convex-helpers/server/pagination";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "../_generated/server.js";
import schema from "../schema.js";
import {
  checkoutSessionDocValidator, checkoutSessionStatusValidator,
  subscriptionDocValidator, subscriptionStatusValidator,
} from "../billing/validators.js";
import { historyOptions, historyResult } from "./scope.js";

export const paginateSubscriptions = query({
  args: {
    userId: v.string(), accountId: v.optional(v.string()),
    status: v.optional(subscriptionStatusValidator), paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(subscriptionDocValidator),
  handler: async (ctx, args) => {
    const { userId, accountId, status } = args;
    const scope = { kind: "subscriptions" as const, userId, accountId, status };
    const options = historyOptions(scope, args.paginationOpts);
    const rows = paginator(ctx.db, schema).query("subscriptions");
    const scoped = accountId !== undefined
      ? status !== undefined
        ? rows.withIndex("by_userId_and_accountId_and_status", q => q.eq("userId", userId).eq("accountId", accountId).eq("status", status))
        : rows.withIndex("by_userId_and_accountId", q => q.eq("userId", userId).eq("accountId", accountId))
      : status !== undefined
        ? rows.withIndex("by_userId_and_status", q => q.eq("userId", userId).eq("status", status))
        : rows.withIndex("by_user_id", q => q.eq("userId", userId));
    return historyResult(scope, await scoped.order("desc").paginate(options));
  },
});

export const paginateCheckoutSessions = query({
  args: {
    userId: v.string(), accountId: v.optional(v.string()),
    status: v.optional(checkoutSessionStatusValidator), paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(checkoutSessionDocValidator),
  handler: async (ctx, args) => {
    const { userId, accountId, status } = args;
    const scope = { kind: "checkoutSessions" as const, userId, accountId, status };
    const options = historyOptions(scope, args.paginationOpts);
    const rows = paginator(ctx.db, schema).query("checkoutSessions");
    const scoped = accountId !== undefined
      ? status !== undefined
        ? rows.withIndex("by_userId_and_accountId_and_status", q => q.eq("userId", userId).eq("accountId", accountId).eq("status", status))
        : rows.withIndex("by_userId_and_accountId", q => q.eq("userId", userId).eq("accountId", accountId))
      : status !== undefined
        ? rows.withIndex("by_user_status", q => q.eq("userId", userId).eq("status", status))
        : rows.withIndex("by_user_id", q => q.eq("userId", userId));
    return historyResult(scope, await scoped.order("desc").paginate(options));
  },
});
