import { v } from "convex/values";
import { mutation } from "../earnings/triggers.js";
import { groupDoc, groupInput } from "./schema.js";
import {
  balance,
  batchLimit,
  groupTarget,
  integer,
  readBalance,
  validateScope,
} from "./helpers.js";
import { reserveGroup, sealGroup } from "./reservations.js";

const unavailable = v.union(
  v.object({
    status: v.literal("conflict"),
    reason: v.union(v.literal("scope_busy"), v.literal("identity_changed")),
    retryable: v.literal(false),
  }),
  v.object({
    status: v.literal("rejected"),
    reason: v.union(v.literal("invalid_scope"), v.literal("policy_invalid")),
    retryable: v.literal(false),
  }),
);
const rejected = (reason: "invalid_scope" | "policy_invalid") => ({
  status: "rejected" as const,
  reason,
  retryable: false as const,
});
const conflict = (reason: "scope_busy" | "identity_changed") => ({
  status: "conflict" as const,
  reason,
  retryable: false as const,
});

/** Host authorizes opaque scope and policy. One call reserves at most one batch. */
export const prepare = mutation({
  args: { ...groupInput, limit: v.optional(v.number()) },
  returns: v.union(
    v.object({
      status: v.literal("prepared"),
      group: groupDoc,
      isDone: v.boolean(),
    }),
    unavailable,
  ),
  handler: async (ctx, args) => {
    try {
      validateScope(args);
      if (
        !args.accountId.trim() ||
        !args.scopeKey.trim() ||
        !args.groupKey.trim() ||
        !args.sourceId.trim()
      )
        return rejected("invalid_scope");
    } catch {
      return rejected("invalid_scope");
    }
    try {
      batchLimit(args.limit ?? 100);
      [args.maxDebit, args.maxCredit].forEach(integer);
      if (args.maxDebit < 0 || args.maxCredit < 0)
        return rejected("policy_invalid");
      if (args.sourceGross !== undefined && integer(args.sourceGross) <= 0)
        return rejected("policy_invalid");
      if (
        args.sourceProcessingFee !== undefined &&
        integer(args.sourceProcessingFee) < 0
      )
        return rejected("policy_invalid");
      if (
        args.sourceKind === "settlement" &&
        (args.sourceGross === undefined ||
          args.sourceProcessingFee === undefined)
      )
        return rejected("policy_invalid");
    } catch {
      return rejected("policy_invalid");
    }
    const existing = await ctx.db
      .query("recoveryGroups")
      .withIndex("by_key", (q) => q.eq("groupKey", args.groupKey))
      .unique();
    if (existing) {
      for (const key of [
        "accountId",
        "scopeKey",
        "currency",
        "sourceKind",
        "sourceId",
        "sourceGross",
        "sourceProcessingFee",
        "maxDebit",
        "maxCredit",
      ] as const)
        if (existing[key] !== args[key]) return conflict("identity_changed");
      if (existing.status !== "open")
        return { status: "prepared" as const, group: existing, isDone: true };
    }
    const current = await readBalance(ctx, args);
    if (current?.activeGroupKey && current.activeGroupKey !== args.groupKey)
      return conflict("scope_busy");
    const sequence = integer((existing?.preparationSequence ?? 0) + 1);
    const operationKey = `recovery-preparation:${JSON.stringify([args.groupKey, sequence])}`;
    // Legacy callers can choose arbitrary keys. A collision must never replay their operation.
    const collision = await ctx.db
      .query("recoveryReservations")
      .withIndex("by_key", (q) => q.eq("operationKey", operationKey))
      .unique();
    if (collision) return conflict("identity_changed");
    const { group } = await reserveGroup(ctx, { ...args, operationKey });
    await ctx.db.patch("recoveryGroups", group._id, {
      preparationSequence: sequence,
    });
    const ledger = await balance(ctx, args);
    const isDone = groupTarget(group, ledger.outstanding) === group.amount;
    const result = isDone
      ? await sealGroup(ctx, { groupKey: args.groupKey })
      : (await ctx.db.get("recoveryGroups", group._id))!;
    return { status: "prepared" as const, group: result, isDone };
  },
});
