import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "../_generated/server.js";
import {
  allowanceStatus,
  limitPolicy,
} from "../../client/usage/allowanceTerms.js";
import { terms, json, policyRow, active } from "./helpers.js";
import { historyDoc } from "./schema.js";
export const status = query({
  args: { bindingJson: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const original = terms(json(args.bindingJson)),
      row = await policyRow(ctx, original.key);
    if (!row || row.bindingJson !== original.bindingJson) return null;
    const result = allowanceStatus(
      original.binding,
      limitPolicy(JSON.parse(row.policyJson), original.binding),
      row,
      Math.floor(Date.now() / 1000),
    );
    try {
      await active(ctx, original.binding);
    } catch {
      result.accepting = false;
    }
    return JSON.stringify(result);
  },
});
export const readHistory = query({
  args: { bindingJson: v.string(), paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(historyDoc),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const original = terms(json(args.bindingJson)),
      row = await policyRow(ctx, original.key);
    if (!row || row.bindingJson !== original.bindingJson)
      throw new Error("Allowance policy unavailable");
    if (
      !Number.isInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > 100
    )
      throw new Error("Invalid allowance history page");
    const result = await ctx.db
      .query("usageAllowanceHistory")
      .withIndex("by_key", (q) => q.eq("key", row.key))
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        maximumRowsRead: 200,
        maximumBytesRead: 1024 * 1024,
      });
    return {
      page: result.page,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const reconciliation = query({
  args: { bindingJson: v.string() },
  returns: v.object({
    status: v.union(v.literal("matched"), v.literal("held")),
    reason: v.string(),
    consumedScaledQuantity: v.string(),
    reservedScaledQuantity: v.string(),
    acceptedScaledQuantity: v.string(),
    repaired: v.literal(false),
  }),
  handler: async (ctx, args) => {
    const original = terms(json(args.bindingJson)),
      row = await policyRow(ctx, original.key);
    if (!row || row.bindingJson !== original.bindingJson)
      throw new Error("Allowance policy unavailable");
    const events = await ctx.db
      .query("usageEvents")
      .withIndex("by_scope_time", (q) =>
        q
          .eq("scopeKey", row.scopeKey)
          .gte("occurredAt", row.start)
          .lt("occurredAt", row.end),
      )
      .take(501);
    const reservations = await ctx.db
      .query("usageReservations")
      .withIndex("by_account_state", (q) =>
        q.eq("accountKey", row.key).eq("state", "reserved"),
      )
      .take(501);
    let accepted = 0n,
      reserved = 0n,
      complete = events.length <= 500 && reservations.length <= 500;
    for (const event of events) {
      const record = JSON.parse(event.recordJson);
      const reservation = event.reservationId
        ? await ctx.db.get("usageReservations", event.reservationId)
        : null;
      if (
        !reservation ||
        reservation.accountKey !== row.key ||
        reservation.state !== "committed" ||
        reservation.eventId !== event._id ||
        reservation.scaledQuantity !== record.scaledQuantity
      )
        complete = false;
      accepted += BigInt(record.scaledQuantity);
    }
    for (const reservation of reservations)
      reserved += BigInt(reservation.scaledQuantity);
    const matches =
      complete &&
      accepted.toString() === row.consumed &&
      reserved.toString() === row.reserved;
    return {
      status: matches ? ("matched" as const) : ("held" as const),
      reason: matches
        ? "complete_local_accounting"
        : complete
          ? "accounting_mismatch"
          : "local_evidence_incomplete",
      consumedScaledQuantity: row.consumed,
      reservedScaledQuantity: row.reserved,
      acceptedScaledQuantity: accepted.toString(),
      repaired: false as const,
    };
  },
});
