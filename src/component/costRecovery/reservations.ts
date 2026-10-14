import { v } from "convex/values";
import type { MutationCtx } from "../_generated/server.js";
import { reserveArgs } from "./schema.js";
import {
  balance,
  batchLimit,
  getGroup,
  groupTarget,
  integer,
  sign,
  validateScope,
} from "./helpers.js";

import type { Infer } from "convex/values";
const _reserveArgs = v.object(reserveArgs);
export async function reserveGroup(
  ctx: MutationCtx,
  args: Infer<typeof _reserveArgs>,
) {
  validateScope(args);
  const limit = args.limit ?? 100;
  batchLimit(limit);
  [args.maxDebit, args.maxCredit].forEach(integer);
  if (
    !args.groupKey.trim() ||
    !args.operationKey.trim() ||
    !args.sourceId ||
    args.maxDebit < 0 ||
    args.maxCredit < 0
  )
    throw new Error("Invalid recovery operation identity or limits.");
  if (args.sourceGross !== undefined && integer(args.sourceGross) <= 0)
    throw new Error("Funding gross must be positive.");
  if (
    args.sourceProcessingFee !== undefined &&
    integer(args.sourceProcessingFee) < 0
  )
    throw new Error("Funding processing fee must be nonnegative.");
  if (
    args.sourceKind === "settlement" &&
    (!args.sourceGross || args.sourceProcessingFee === undefined)
  )
    throw new Error("Settlement recovery requires original funding gross.");
  let group = await ctx.db
    .query("recoveryGroups")
    .withIndex("by_key", (q) => q.eq("groupKey", args.groupKey))
    .unique();
  const existing = await ctx.db
    .query("recoveryReservations")
    .withIndex("by_key", (q) => q.eq("operationKey", args.operationKey))
    .unique();
  if (group)
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
      if (group[key] !== args[key])
        throw new Error("Recovery group identity and limits cannot change.");
  if (existing) {
    if (
      existing.groupKey !== args.groupKey ||
      existing.limit !== limit ||
      !group
    )
      throw new Error("Recovery operation identity cannot change.");
    return { reservation: existing, group };
  }
  const ledger = await balance(ctx, args);
  if (ledger.activeGroupKey && ledger.activeGroupKey !== args.groupKey)
    throw new Error("Another recovery boundary is pending.");
  if (group && group.status !== "open")
    throw new Error(
      "Recovery group is sealed; replay its existing operations.",
    );
  if (!group) {
    const { operationKey: _operationKey, limit: _limit, ...input } = args;
    const id = await ctx.db.insert("recoveryGroups", {
      ...input,
      amount: 0,
      pendingOperations: 0,
      status: "open",
    });
    group = (await ctx.db.get("recoveryGroups", id))!;
  }
  const delta = integer(groupTarget(group, ledger.outstanding) - group.amount);
  const direction = sign(delta);
  let remaining = Math.abs(delta),
    amount = 0;
  const allocations: {
    claimId: import("../_generated/dataModel.js").Id<"recoveryClaims">;
    claimKey: string;
    amount: number;
  }[] = [];
  if (direction !== "zero") {
    const claims = await ctx.db
      .query("recoveryClaims")
      .withIndex("by_sign", (q) =>
        q
          .eq("accountId", args.accountId)
          .eq("scopeKey", args.scopeKey)
          .eq("currency", args.currency)
          .eq("sign", direction),
      )
      .take(limit);
    for (const claim of claims) {
      if (!remaining) break;
      const take =
        Math.min(remaining, Math.abs(claim.outstanding)) * (delta < 0 ? -1 : 1);
      const reservedAmount = integer(claim.reservedAmount + take),
        outstanding = integer(claim.outstanding - take);
      await ctx.db.patch("recoveryClaims", claim._id, {
        reservedAmount,
        outstanding,
        sign: sign(outstanding),
      });
      allocations.push({
        claimId: claim._id,
        claimKey: claim.claimKey,
        amount: take,
      });
      amount = integer(amount + take);
      remaining -= Math.abs(take);
    }
  }
  const reservationId = await ctx.db.insert("recoveryReservations", {
    operationKey: args.operationKey,
    groupKey: args.groupKey,
    amount,
    limit,
    allocations,
    status: allocations.length ? "reserved" : "empty",
  });
  if (allocations.length) {
    await ctx.db.patch("recoveryBalances", ledger._id, {
      reservedAmount: integer(ledger.reservedAmount + amount),
      outstanding: integer(ledger.outstanding - amount),
      activeGroupKey: group.groupKey,
    });
    await ctx.db.patch("recoveryGroups", group._id, {
      amount: integer(group.amount + amount),
      pendingOperations: group.pendingOperations + 1,
    });
  }
  return {
    reservation: (await ctx.db.get("recoveryReservations", reservationId))!,
    group: (await ctx.db.get("recoveryGroups", group._id))!,
  };
}
export async function sealGroup(ctx: MutationCtx, args: { groupKey: string }) {
  const group = await getGroup(ctx, args.groupKey);
  if (group.status !== "open") return group;
  const ledger = await balance(ctx, group);
  if (groupTarget(group, ledger.outstanding) !== group.amount)
    throw new Error("Recovery needs another reservation batch before sealing.");
  await ctx.db.patch("recoveryGroups", group._id, { status: "sealed" });
  return (await ctx.db.get("recoveryGroups", group._id))!;
}
