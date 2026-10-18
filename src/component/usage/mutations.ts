import { v } from "convex/values";
import type { FunctionHandle } from "convex/server";
import { mutation } from "../_generated/server.js";
import {
  prepareUsageRecord,
  type PreparedUsageRecord,
} from "../../client/usage/records.js";
import { defineUsagePlan } from "../../client/usage/contracts.js";
import { assertUsageReplay } from "../../client/usage/boundaries.js";
import { scopeKey, subscriptionSnapshot } from "./helpers.js";

/** Trusted host mutation. Authenticate, authorize scope and verify native binding first. */
export const record = mutation({
  args: {
    inputJson: v.string(),
    subscriptionJson: v.string(),
    dispatch: v.optional(v.string()),
    reservationId: v.optional(v.id("usageReservations")),
    quota: v.optional(v.number()),
  },
  returns: v.object({
    eventId: v.id("usageEvents"),
    identity: v.string(),
    acceptedAt: v.number(),
    delivery: v.literal("queued"),
  }),
  handler: async (ctx, args) => {
    if (new TextEncoder().encode(args.inputJson).length > 8192)
      throw new Error("Usage payload exceeds size limit");
    const event = prepareUsageRecord(JSON.parse(args.inputJson));
    const key = scopeKey(event.scope);
    const subscription = subscriptionSnapshot(args.subscriptionJson);
    const subscriptionJson = JSON.stringify(subscription);
    const existing = await ctx.db
      .query("usageEvents")
      .withIndex("by_identity", (q) => q.eq("identity", event.identity))
      .unique();
    if (existing) {
      if (
        args.reservationId !== undefined &&
        args.reservationId !== existing.reservationId
      )
        throw new Error("Conflicting usage reservation replay");
      assertUsageReplay(
        JSON.parse(existing.recordJson) as PreparedUsageRecord,
        event,
      );
      if (existing.subscriptionJson !== subscriptionJson)
        throw new Error("Conflicting usage replay");
      const outbox = await ctx.db
        .query("usageOutbox")
        .withIndex("by_event", (q) => q.eq("eventId", existing._id))
        .unique();
      if (!outbox) throw new Error("Usage outbox invariant violated");
      // Acceptance is an immutable receipt; subsequent delivery is read separately.
      return {
        eventId: existing._id,
        identity: existing.identity,
        acceptedAt: existing.acceptedAt,
        delivery: "queued" as const,
      };
    }
    const now = Math.floor(Date.now() / 1000);
    if (event.occurredAt < now - 35 * 86400 || event.occurredAt > now + 300)
      throw new Error("Usage occurrence is outside the native delivery window");
    if (
      event.binding.stripePriceId !== subscription.stripePriceId ||
      event.occurredAt < subscription.period.start ||
      event.occurredAt >= subscription.period.end
    )
      throw new Error("Usage does not match its subscription period/price");
    const quota = args.quota ?? 100000;
    if (!Number.isInteger(quota) || quota < 1 || quota > 100000)
      throw new Error("Invalid usage scope quota");
    const counter = await ctx.db
      .query("usageScopeCounters")
      .withIndex("by_scope", (q) => q.eq("scopeKey", key))
      .unique();
    if ((counter?.count ?? 0) >= quota)
      throw new Error("Usage scope quota exhausted");
    const reservation = args.reservationId
      ? await ctx.db.get("usageReservations", args.reservationId)
      : null;
    if (event.binding.plan.model === "prepaid" && !reservation)
      throw new Error("A matching usage reservation is required");
    if (
      reservation &&
      (reservation.scopeKey !== key ||
        reservation.sourceEventId !== event.sourceEventId ||
        JSON.stringify(defineUsagePlan(JSON.parse(reservation.planJson))) !==
          JSON.stringify(event.binding.plan) ||
        reservation.scaledQuantity !== event.scaledQuantity ||
        reservation.state !== "reserved")
    )
      throw new Error("Usage reservation does not match event");
    const eventId = await ctx.db.insert("usageEvents", {
      reservationId: args.reservationId,
      scopeKey: key,
      identity: event.identity,
      recordJson: JSON.stringify(event),
      subscriptionJson,
      occurredAt: event.occurredAt,
      acceptedAt: now,
    });
    await ctx.db.insert("usageOutbox", {
      eventId,
      scopeKey: key,
      state: "queued",
      attempts: 0,
      nextAttemptAt: now,
      providerIdentifier: `bs_usage_${eventId}`,
      dispatch: args.dispatch,
    });
    if (counter)
      await ctx.db.patch("usageScopeCounters", counter._id, {
        count: counter.count + 1,
      });
    else await ctx.db.insert("usageScopeCounters", { scopeKey: key, count: 1 });
    if (reservation)
      await ctx.db.patch("usageReservations", reservation._id, {
        state: "committed",
        eventId,
      });
    if (args.dispatch)
      await ctx.scheduler.runAfter(
        0,
        args.dispatch as FunctionHandle<"action">,
        { eventId },
      );
    return {
      eventId,
      identity: event.identity,
      acceptedAt: now,
      delivery: "queued" as const,
    };
  },
});
