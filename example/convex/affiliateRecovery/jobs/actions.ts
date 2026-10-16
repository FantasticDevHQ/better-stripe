import { v } from "convex/values";

import { internalAction } from "../../_generated/server";

import { internal } from "../../_generated/api";

import { stripe } from "../../stripe/helpers";

export const start = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    for (const state of ["pending", "unknown"] as const)
      await ctx.scheduler.runAfter(
        0,
        internal.affiliateRecovery.jobs.actions.batch,
        {
          state,
        },
      );
    for (const state of ["pending", "unknown"] as const)
      await ctx.scheduler.runAfter(
        0,
        internal.affiliateRecovery.jobs.actions.batch,
        {
          state,
          payouts: true,
        },
      );
    return null;
  },
});

export const batch = internalAction({
  args: {
    state: v.union(v.literal("pending"), v.literal("unknown")),
    cursor: v.optional(v.string()),
    payouts: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const page = await (args.payouts
      ? stripe.affiliateRecovery.reconcilePayouts(ctx, {
          state: args.state,
          paginationOpts: { numItems: 1, cursor: args.cursor ?? null },
        })
      : stripe.affiliateRecovery.reconcilePending(ctx, {
          state: args.state,
          paginationOpts: { numItems: 1, cursor: args.cursor ?? null },
        }));
    if (!page.isDone)
      await ctx.scheduler.runAfter(
        0,
        internal.affiliateRecovery.jobs.actions.batch,
        {
          state: args.state,
          cursor: page.continueCursor,
          payouts: args.payouts,
        },
      );
    return null;
  },
});
