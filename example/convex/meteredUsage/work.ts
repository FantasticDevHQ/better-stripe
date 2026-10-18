import { v } from "convex/values";
import { UsageCreditError } from "@fantastic.dev/better-stripe/usage";
import { internalMutation } from "../_generated/server";
import { stripe } from "../stripe/helpers";
import { demoRun } from "./authorization";
import type { DemoProviderState } from "./types";
/** Synthetic DB work, package reservation/acceptance and the host marker share one transaction. */
export const accept = internalMutation({
  args: {
    actorId: v.id("users"),
    runId: v.id("meteredDemoRuns"),
    activityId: v.id("meteredDemoActivities"),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const run = await demoRun(ctx, args.actorId, args.runId);
    const work = await ctx.db.get("meteredDemoActivities", args.activityId);
    if (!work || work.runId !== run._id || !run.providerJson)
      throw new Error("Original synthetic work is unavailable.");
    const { meter } = JSON.parse(run.providerJson) as DemoProviderState;
    if (work.receiptId) {
      const retained = await stripe.usage.get(ctx, {
        scope: meter.scope,
        eventId: work.receiptId,
      });
      if (
        !retained ||
        retained.record.sourceEventId !== `demo_work_${work._id}`
      )
        throw new Error("Original accepted work requires reconciliation.");
      return JSON.stringify({
        status: "accepted",
        receiptId: work.receiptId,
        work: "already_completed",
        cashCollection: "none",
      });
    }
    if (run.archived || run.billingStartedAt !== undefined)
      throw new Error(
        "The original billing period is closing. Resume existing operations before new work.",
      );
    const event = {
      scope: meter.scope,
      binding: meter.binding,
      sourceEventId: `demo_work_${work._id}`,
      quantity: work.quantity,
      occurredAt: work.occurredAt,
    };
    let reservation;
    try {
      reservation =
        run.model === "prepaid"
          ? await stripe.usage.reserveCredits(ctx, {
              event,
              subscription: meter.subscription,
            })
          : await stripe.usage.reserveAllowance(ctx, {
              event,
              subscription: meter.subscription,
            });
    } catch (error) {
      if (run.model !== "prepaid") throw error;
      return JSON.stringify({
        status:
          error instanceof UsageCreditError &&
          error.code === "insufficient_credits"
            ? "denied"
            : "held",
        reason:
          error instanceof UsageCreditError &&
          error.code === "insufficient_credits"
            ? "insufficient_credits"
            : "credit_reservation_unavailable",
        work: "not_performed",
        cashCollection: "none",
      });
    }
    if (reservation.state === "denied")
      return JSON.stringify({
        status: "denied",
        reason: reservation.reason,
        work: "not_performed",
        cashCollection: "none",
      });
    if (reservation.state === "released")
      return JSON.stringify({
        status: "held",
        reason: "original_reservation_released",
        work: "not_performed",
        cashCollection: "none",
      });
    const receipt = await stripe.usage.record(ctx, {
      event,
      subscription: meter.subscription,
      reservationId: reservation.reservationId,
    });
    await ctx.db.patch("meteredDemoActivities", work._id, {
      completedAt: work.completedAt ?? Date.now(),
      receiptId: receipt.eventId,
    });
    await ctx.db.patch("meteredDemoRuns", run._id, {
      lastAcceptedActivityId: work._id,
    });
    return JSON.stringify({
      status: "accepted",
      receiptId: receipt.eventId,
      work:
        work.completedAt === undefined ? "completed_once" : "already_completed",
      cashCollection: "none",
    });
  },
});
