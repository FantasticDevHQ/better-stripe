import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { stripe } from "./stripe";
import { recipient, scope } from "./payoutWorkerScope";
const kinds = ["policies", "recovering", "expiry", "changing"] as const;
const kind = v.union(...kinds.map((k) => v.literal(k)));
/** Installed before custom policy activation. Default Stripe-managed recipients do not enter the release queue. */
export const dispatch = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    for (const kind of kinds)
      await ctx.scheduler.runAfter(0, internal.payoutWorkers.scan, {
        kind,
        cursor: null,
      });
    return null;
  },
});
export const scan = internalAction({
  args: { kind, cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const paginationOpts = { cursor: args.cursor, numItems: 5 };
    if (args.kind === "recovering") {
      const result = await stripe.payoutPolicy.worker.recovering(
        ctx,
        paginationOpts,
      );
      for (const job of result.page)
        await ctx.scheduler.runAfter(0, internal.payoutWorkers.attempt, {
          accountId: job.accountId,
          ownerKey: job.ownerKey,
          currency: job.currency,
        });
      if (!result.isDone)
        await ctx.scheduler.runAfter(0, internal.payoutWorkers.scan, {
          ...args,
          cursor: result.continueCursor,
        });
    } else {
      const result =
        args.kind === "expiry"
          ? await stripe.payoutPolicy.due(ctx, paginationOpts)
          : args.kind === "changing"
            ? await stripe.payoutPolicy.worker.changing(ctx, paginationOpts)
            : await stripe.payoutPolicy.worker.policies(ctx, paginationOpts);
      for (const policy of result.page) {
        const recipient = {
          accountId: policy.accountId,
          ownerKey: policy.ownerKey,
        };
        if (args.kind === "expiry")
          await ctx.scheduler.runAfter(
            0,
            internal.payoutWorkers.expire,
            recipient,
          );
        else if (args.kind === "changing")
          await ctx.scheduler.runAfter(
            0,
            internal.payoutWorkers.apply,
            recipient,
          );
        else
          for (const threshold of policy.thresholds)
            await ctx.scheduler.runAfter(0, internal.payoutWorkers.attempt, {
              ...recipient,
              currency: threshold.currency,
            });
      }
      if (!result.isDone)
        await ctx.scheduler.runAfter(0, internal.payoutWorkers.scan, {
          ...args,
          cursor: result.continueCursor,
        });
    }
    return null;
  },
});
export const attempt = internalAction({
  args: scope,
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const liabilityQuote = await ctx.runQuery(
      internal.payoutWorkerScope.liabilities,
      args,
    );
    const result = await stripe.payoutPolicy.worker.run(ctx, {
      ...args,
      ...liabilityQuote,
    });
    if (
      result.status === "completed" &&
      result.payout.status !== "held" &&
      result.payout.claim.status === "rejected"
    )
      console.warn("Automatic payout rejected by Stripe", {
        accountId: args.accountId,
        currency: args.currency,
        reason: result.payout.claim.rejection?.code ?? "rejected",
        nextAttemptAt: result.job.nextAttemptAt,
      });
    return null;
  },
});
export const expire = internalAction({
  args: recipient,
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await ctx.runQuery(internal.payoutWorkerScope.liabilities, {
      ...args,
      currency: "usd",
    });
    const result = await stripe.payoutPolicy.expire(ctx, args);
    if (
      result.status !== "ready" &&
      result.status !== "not_due" &&
      result.status !== "canceled"
    )
      console.warn("Holding expiry requires operator recovery", {
        accountId: args.accountId,
        ...(result.status === "expiry_unresolved"
          ? {
              deadline: result.holdingExpiry.deadline,
              reason: result.holdingExpiry.status,
            }
          : { reason: "reason" in result ? result.reason : result.status }),
      });
    return null;
  },
});
export const apply = internalAction({
  args: recipient,
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await ctx.runQuery(internal.payoutWorkerScope.liabilities, {
      ...args,
      currency: "usd",
    });
    const policy = await stripe.payoutPolicy.get(ctx, args);
    if (policy?.status === "changing")
      await stripe.payoutPolicy.apply(ctx, {
        ...args,
        operationKey: policy.operationKey,
      });
    return null;
  },
});
