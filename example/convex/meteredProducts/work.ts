import { v } from "convex/values";
import {
  UsageCreditError,
  parseUsageQuantity,
  type UsageSubscriptionView,
} from "@fantastic.dev/better-stripe/usage";
import { action, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { demoActor } from "../meteredUsage/authorization";
import { stripe } from "../stripe/helpers";
import { enrollmentRef } from "./schema";
import { paidEnrollment } from "./payment";
export const accept = internalMutation({
  args: {
    ...enrollmentRef,
    requestId: v.string(),
    quantity: v.string(),
    verifiedProviderJson: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    await demoActor(ctx, args.actorId);
    const enrollment = await ctx.db.get(
      "meteredProductEnrollments",
      args.enrollmentId,
    );
    if (
      !enrollment ||
      enrollment.buyerId !== args.actorId ||
      !enrollment.providerJson
    )
      throw new Error("Original enrollment is unavailable.");
    if (!/^[\w.-]{1,100}$/.test(args.requestId))
      throw new Error("Invalid coaching session identity.");
    if (enrollment.providerJson !== args.verifiedProviderJson)
      throw new Error(
        "The verified billing period changed. Refresh payment before retrying.",
      );
    const subscription = JSON.parse(
      enrollment.providerJson,
    ) as UsageSubscriptionView;
    const meter = subscription.bindings[0];
    const quantity = parseUsageQuantity(
      args.quantity,
      meter.binding.plan.unit.precision,
    ).quantity;
    if (quantity === "0") throw new Error("Record a positive number of units.");
    const saved = await ctx.db
      .query("coachingSessions")
      .withIndex("by_enrollment_request", (q) =>
        q.eq("enrollmentId", enrollment._id).eq("requestId", args.requestId),
      )
      .unique();
    if (saved) {
      if (saved.quantity !== quantity)
        throw new Error("Replay must retain original session units.");
      return JSON.stringify({
        status: "accepted",
        work: "already_completed",
        receiptId: saved.receiptId,
      });
    }
    const now = Math.floor(Date.now() / 1000);
    if (
      subscription.status !== "active" ||
      now < meter.subscription.period.start ||
      now >= meter.subscription.period.end
    )
      throw new Error("Refresh the original active billing period.");
    if (
      meter.binding.plan.model !== "prepaid" &&
      !(await stripe.usage.getAllowanceStatus(ctx, meter))
    )
      await stripe.usage.configureAllowance(ctx, {
        ...meter,
        expectedRevision: 0,
        policy: {
          reset: "billing_period",
          rollover: "none",
          entitled: true,
          overage: "allow",
          limit: { mode: "none" },
        },
      });
    const event = {
      scope: meter.scope,
      binding: meter.binding,
      sourceEventId: `product_${enrollment._id}_${args.requestId}`,
      quantity,
      occurredAt: now,
    };
    let reservation;
    try {
      reservation =
        meter.binding.plan.model === "prepaid"
          ? await stripe.usage.reserveCredits(ctx, {
              event,
              subscription: meter.subscription,
            })
          : await stripe.usage.reserveAllowance(ctx, {
              event,
              subscription: meter.subscription,
            });
    } catch (error) {
      if (!(error instanceof UsageCreditError)) throw error;
      return JSON.stringify({
        status: error.code === "insufficient_credits" ? "denied" : "held",
        work: "not_performed",
      });
    }
    if (reservation.state !== "reserved")
      return JSON.stringify({
        status: reservation.state === "denied" ? "denied" : "held",
        work: "not_performed",
      });
    const receipt = await stripe.usage.record(ctx, {
      event,
      subscription: meter.subscription,
      reservationId: reservation.reservationId,
    });
    await ctx.db.insert("coachingSessions", {
      enrollmentId: enrollment._id,
      requestId: args.requestId,
      quantity,
      occurredAt: now,
      receiptId: receipt.eventId,
    });
    return JSON.stringify({
      status: "accepted",
      work: "completed_once",
      receiptId: receipt.eventId,
    });
  },
});
export const consume = action({
  args: { ...enrollmentRef, requestId: v.string(), quantity: v.string() },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const { meter, subscription } = await paidEnrollment(ctx, args);
    const result: string = await ctx.runMutation(
      internal.meteredProducts.work.accept,
      { ...args, verifiedProviderJson: JSON.stringify(subscription) },
    );
    const value = JSON.parse(result) as { status: string; receiptId?: string };
    if (value.status === "accepted" && value.receiptId) {
      const retained = await stripe.usage.get(ctx, {
        scope: meter.scope,
        eventId: value.receiptId,
      });
      if (retained?.delivery === "queued")
        await stripe.usage.startDelivery(ctx, {
          scope: meter.scope,
          eventId: value.receiptId,
          provider: internal.meteredUsage.delivery.deliver,
        });
    }
    return result;
  },
});
