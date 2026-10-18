import { v } from "convex/values";
import { action, env, type ActionCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { stripe } from "../stripe/helpers";
import { originalDemoRun } from "./original";
import type { DemoRef } from "./resources";
const ref = { actorId: v.id("users"), runId: v.id("meteredDemoRuns") };
async function perform(
  ctx: ActionCtx,
  ref: DemoRef,
  work: Doc<"meteredDemoActivities">,
): Promise<string> {
  const { meter } = await originalDemoRun(ctx, ref);
  const serialized = await ctx.runMutation(internal.meteredUsage.work.accept, {
    ...ref,
    activityId: work._id,
  });
  const result = JSON.parse(serialized) as {
    status: string;
    receiptId?: string;
  };
  if (result.status === "accepted" && result.receiptId) {
    const current = await stripe.usage.get(ctx, {
      scope: meter.scope,
      eventId: result.receiptId,
    });
    if (current?.delivery === "queued")
      await stripe.usage.startDelivery(ctx, {
        scope: meter.scope,
        eventId: result.receiptId,
        provider: internal.meteredUsage.delivery.deliver,
      });
  }
  return serialized;
}
export const consume = action({
  args: { ...ref, requestId: v.string(), quantity: v.string() },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const ref = { actorId: args.actorId, runId: args.runId };
    await originalDemoRun(ctx, ref);
    const work = await ctx.runMutation(
      internal.meteredUsage.state.activity,
      args,
    );
    return perform(ctx, ref, work);
  },
});
export const replay = action({
  args: ref,
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    await originalDemoRun(ctx, args);
    const work = await ctx.runQuery(
      internal.meteredUsage.state.lastActivity,
      args,
    );
    if (!work)
      throw new Error("No original synthetic work is available to replay.");
    return perform(ctx, args, work);
  },
});
export const correct = action({
  args: ref,
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const { meter } = await originalDemoRun(ctx, args);
    const work = await ctx.runMutation(
      internal.meteredUsage.state.prepareCorrection,
      args,
    );
    if (!work?.receiptId)
      throw new Error(
        "No accepted original event is available for correction.",
      );
    return JSON.stringify(
      await stripe.usage.requestCorrection(
        ctx,
        {
          scope: meter.scope,
          eventId: work.receiptId,
          correctionId: `demo_cancel_${work._id}`,
          actor: `demo:${args.actorId}`,
          reason: "Synthetic work canceled by its demo persona",
          operation: "cancel",
        },
        { stripeSecretKey: env.STRIPE_SECRET_KEY },
      ),
    );
  },
});
/** Explicit bounded retry of queued records only. Unknown attempts require reconciliation. */
export const deliverQueued = action({
  args: ref,
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const { meter } = await originalDemoRun(ctx, args);
    const page = await stripe.usage.read(ctx, {
      scope: meter.scope,
      page: { period: meter.subscription.period, limit: 100, cursor: null },
    });
    if (!page.isDone)
      throw new Error(
        "Complete scoped history is required before demo delivery.",
      );
    let scheduled = 0;
    for (const row of page.events)
      if (row.delivery === "queued") {
        await stripe.usage.startDelivery(ctx, {
          scope: meter.scope,
          eventId: row.receipt.eventId,
          provider: internal.meteredUsage.delivery.deliver,
        });
        scheduled++;
      }
    return JSON.stringify({ status: "scheduled", scheduled });
  },
});
