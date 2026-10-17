import { v } from "convex/values";
import { query, internalQuery } from "../../_generated/server";
import { stripe } from "../../stripe/helpers";
import { recoveryJobDoc, operationRefFields } from "./validators";
import { readJob, jobReference } from "./helpers";
export const owned = internalQuery({
  args: operationRefFields,
  returns: recoveryJobDoc,
  handler: readJob,
});
export const list = query({
  args: { sellerId: v.id("users") },
  returns: v.array(
    v.object({
      kind: v.string(),
      sourceId: v.string(),
      status: v.string(),
      reason: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const seller = await ctx.db.get("users", args.sellerId);
    if (seller?.role !== "seller" || !seller.stripeAccountId)
      throw new Error("Choose a seller to view recovery.");
    const jobs = await ctx.db
      .query("recoveryJobs")
      .withIndex("by_seller", (q) => q.eq("sellerId", args.sellerId))
      .order("desc")
      .take(100);
    return Promise.all(
      jobs.map(async (job) => {
        if (job.accountId !== seller.stripeAccountId)
          throw new Error("Original recovery owner changed.");
        if (job.blockedReason)
          return {
            kind: job.kind,
            sourceId: job.sourceId,
            status: "blocked",
            reason: job.blockedReason,
          };
        if (job.legacyVerified)
          return {
            kind: job.kind,
            sourceId: job.sourceId,
            status: "completed",
          };
        const state =
          job.kind === "cost"
            ? await stripe.costRecovery.getProcessingCostReconciliation(
                ctx,
                jobReference(job),
              )
            : await stripe.costRecovery.getGroupOperation(ctx, {
                ...jobReference(job),
                groupKey: job.groupKey!,
              });
        return {
          kind: job.kind,
          sourceId: job.sourceId,
          status: state.status,
          ...("reason" in state ? { reason: state.reason } : {}),
        };
      }),
    );
  },
});

/** Bounded visible count; never claim a complete total beyond the scanned page. */
export const blockedSummary = query({
  args: { sellerId: v.id("users") },
  returns: v.object({ count: v.number(), hasMore: v.boolean() }),
  handler: async (ctx, args) => {
    const seller = await ctx.db.get("users", args.sellerId);
    if (seller?.role !== "seller" || !seller.stripeAccountId)
      throw new Error("Choose a seller to view recovery.");
    const rows = await ctx.db
      .query("recoveryJobs")
      .withIndex("by_seller_blocked", (q) =>
        q.eq("sellerId", args.sellerId).gt("blockedReason", undefined),
      )
      .take(101);
    if (rows.some((row) => row.accountId !== seller.stripeAccountId))
      throw new Error("Original recovery owner changed.");
    return { count: Math.min(rows.length, 100), hasMore: rows.length > 100 };
  },
});
