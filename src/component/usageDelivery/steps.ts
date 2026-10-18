import { appendDeliveryHistory } from "../usageObservations/history.js";
import { internalMutation } from "../_generated/server.js";
import { v } from "convex/values";
import { refFields, request, status } from "./schema.js";
import { outcome } from "./fields.js";
import { read, statusOf, lockKeys } from "./helpers.js";
export const claim = internalMutation({
  args: refFields,
  returns: v.union(
    v.object({ kind: v.literal("ready"), request: v.object(request) }),
    v.object({ kind: v.literal("wait"), delayMs: v.number() }),
    v.object({ kind: v.literal("done") }),
  ),
  handler: async (ctx, args) => {
    const { outbox, record } = await read(ctx, args),
      now = Math.floor(Date.now() / 1000);
    if (
      outbox.held ||
      ["provider_accepted", "rejected", "unknown", "held"].includes(
        outbox.state,
      )
    )
      return { kind: "done" as const };
    if (
      record.occurredAt < now - 35 * 86400 ||
      record.occurredAt > now + 300 ||
      (outbox.firstSendAt !== undefined &&
        now - outbox.firstSendAt >= 23 * 3600)
    ) {
      await ctx.db.patch("usageOutbox", outbox._id, {
        state: outbox.firstSendAt === undefined ? "held" : "unknown",
        reason: "delivery_window_expired",
      });
      await appendDeliveryHistory(
        ctx,
        args.eventId,
        "window_expired",
        outbox.attempts,
        `window:${outbox.attempts}`,
      );
      return { kind: "done" as const };
    }
    if (outbox.state === "sending") {
      if ((outbox.leaseUntil ?? 0) > now)
        return {
          kind: "wait" as const,
          delayMs: Math.min(
            60000,
            Math.max(1000, ((outbox.leaseUntil ?? now) - now) * 1000),
          ),
        };
      await ctx.db.patch("usageOutbox", outbox._id, {
        state: "unknown",
        reason: "provider_outcome_unknown",
      });
      await appendDeliveryHistory(
        ctx,
        args.eventId,
        "unknown",
        outbox.attempts,
        `result:${outbox.attempts}:unknown`,
      );
      return { kind: "done" as const };
    }
    const keys = lockKeys(record);
    const realm = await ctx.db
      .query("usageDeliveryLocks")
      .withIndex("by_key", (q) => q.eq("key", keys.realm))
      .unique();
    const customer = await ctx.db
      .query("usageDeliveryLocks")
      .withIndex("by_key", (q) => q.eq("key", keys.customer))
      .unique();
    const waitUntil = Math.max(
      outbox.nextAttemptAt,
      realm?.nextAttemptAt ?? 0,
      customer?.leaseUntil ?? 0,
    );
    if (waitUntil > now)
      return {
        kind: "wait" as const,
        delayMs: Math.min(60000, (waitUntil - now) * 1000),
      };
    const slot = { key: keys.realm, leaseUntil: 0, nextAttemptAt: now + 1 };
    if (realm) await ctx.db.patch("usageDeliveryLocks", realm._id, slot);
    else await ctx.db.insert("usageDeliveryLocks", slot);
    const lock = {
      key: keys.customer,
      eventId: args.eventId,
      leaseUntil: now + 900,
      nextAttemptAt: 0,
    };
    if (customer) await ctx.db.patch("usageDeliveryLocks", customer._id, lock);
    else await ctx.db.insert("usageDeliveryLocks", lock);
    const attempt = outbox.attempts + 1;
    await ctx.db.patch("usageOutbox", outbox._id, {
      state: "sending",
      attempts: attempt,
      firstSendAt: outbox.firstSendAt ?? now,
      leaseUntil: now + 900,
      reason: undefined,
    });
    await appendDeliveryHistory(
      ctx,
      args.eventId,
      "started",
      attempt,
      `started:${attempt}`,
    );
    return {
      kind: "ready" as const,
      request: {
        ...args,
        attempt,
        definitionVersion: 1 as const,
        apiVersion: record.binding.apiVersion,
        identifier: outbox.providerIdentifier,
      },
    };
  },
});
export const save = internalMutation({
  args: { ...request, outcome },
  returns: status,
  handler: async (ctx, args) => {
    const { outbox, record } = await read(ctx, args);
    if (
      outbox.attempts !== args.attempt ||
      outbox.providerIdentifier !== args.identifier ||
      record.binding.apiVersion !== args.apiVersion ||
      outbox.definitionVersion !== args.definitionVersion
    )
      throw new Error("Stale usage delivery receipt");
    if (outbox.receipt || outbox.state === "rejected") return statusOf(outbox);
    const result = args.outcome,
      now = Math.floor(Date.now() / 1000);
    const update =
      result.status === "accepted"
        ? {
            state: "provider_accepted" as const,
            receipt: { identifier: args.identifier, created: result.created },
            reason: undefined,
          }
        : result.status === "unknown"
          ? {
              state: "unknown" as const,
              reason: "provider_outcome_unknown" as const,
            }
          : result.status === "rejected"
            ? {
                state: "rejected" as const,
                reason: "provider_rejected" as const,
              }
            : result.status === "unavailable"
              ? {
                  state: "held" as const,
                  reason: "provider_unavailable" as const,
                }
              : {
                  state: outbox.held ? ("held" as const) : ("queued" as const),
                  reason: "rate_limited" as const,
                  nextAttemptAt:
                    now + Math.min(60, 2 ** Math.min(outbox.attempts, 6)),
                };
    await ctx.db.patch("usageOutbox", outbox._id, update);
    if (result.status !== "unknown") {
      const key = lockKeys(record).customer;
      const lock = await ctx.db
        .query("usageDeliveryLocks")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      if (lock?.eventId === args.eventId)
        await ctx.db.patch("usageDeliveryLocks", lock._id, {
          leaseUntil: 0,
          eventId: undefined,
        });
    }
    await appendDeliveryHistory(
      ctx,
      args.eventId,
      result.status,
      args.attempt,
      `result:${args.attempt}:${result.status}`,
      result.status === "accepted" ? result.created : undefined,
    );
    return statusOf((await read(ctx, args)).outbox);
  },
});
export const exhaust = internalMutation({
  args: refFields,
  returns: v.null(),
  handler: async (ctx, args) => {
    const { outbox } = await read(ctx, args);
    if (outbox.state === "queued") {
      await ctx.db.patch("usageOutbox", outbox._id, {
        state: "held",
        reason: "retry_exhausted",
      });
      await appendDeliveryHistory(
        ctx,
        args.eventId,
        "retry_exhausted",
        outbox.attempts,
        `exhaust:${outbox.attempts}`,
      );
    }
    return null;
  },
});
