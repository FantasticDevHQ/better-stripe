import { v } from "convex/values";
import type { MutationCtx } from "../_generated/server.js";
import { finishArgs } from "./schema.js";
import {
  adjustTotals,
  balance,
  batchLimit,
  getGroup,
  integer,
  sign,
} from "./helpers.js";

import type { Infer } from "convex/values";
const _finishArgs = v.object(finishArgs);
export async function finishGroup(
  ctx: MutationCtx,
  args: Infer<typeof _finishArgs>,
) {
  const limit = args.limit ?? 10;
  batchLimit(limit, 10);
  const group = await getGroup(ctx, args.groupKey);
  const collect = args.outcome === "collect",
    terminal = collect ? "collected" : "released",
    progress = collect ? "collecting" : "releasing";
  if (group.status === terminal) return { group, isDone: true };
  if (
    (collect && ["released", "releasing"].includes(group.status)) ||
    (!collect && ["collected", "collecting"].includes(group.status))
  )
    throw new Error("Recovery outcome cannot change.");
  if (collect && group.status === "open")
    throw new Error("Seal recovery before confirming provider collection.");
  const operations = await ctx.db
    .query("recoveryReservations")
    .withIndex("by_group_status", (q) =>
      q.eq("groupKey", group.groupKey).eq("status", "reserved"),
    )
    .take(limit);
  let amount = 0;
  for (const operation of operations) {
    for (const allocation of operation.allocations) {
      const claim = await ctx.db.get("recoveryClaims", allocation.claimId);
      if (
        !claim ||
        claim.accountId !== group.accountId ||
        claim.scopeKey !== group.scopeKey ||
        claim.currency !== group.currency
      )
        throw new Error("Recovery allocation identity does not match.");
      const reservedAmount = integer(claim.reservedAmount - allocation.amount);
      const collectedAmount = integer(
        claim.collectedAmount + (collect ? allocation.amount : 0),
      );
      const outstanding = integer(
        claim.amountDue - collectedAmount - reservedAmount,
      );
      await ctx.db.patch("recoveryClaims", claim._id, {
        reservedAmount,
        collectedAmount,
        outstanding,
        sign: sign(outstanding),
      });
    }
    await ctx.db.patch("recoveryReservations", operation._id, {
      status: terminal,
    });
    amount = integer(amount + operation.amount);
  }
  await adjustTotals(ctx, group, {
    reservedAmount: -amount,
    collectedAmount: collect ? amount : 0,
    outstanding: collect ? 0 : amount,
  });
  const pendingOperations = group.pendingOperations - operations.length;
  if (pendingOperations < 0)
    throw new Error("Recovery operation count does not reconcile.");
  await ctx.db.patch("recoveryGroups", group._id, {
    pendingOperations,
    status: pendingOperations ? progress : terminal,
  });
  if (!pendingOperations) {
    const ledger = await balance(ctx, group);
    if (ledger.activeGroupKey === group.groupKey)
      await ctx.db.patch("recoveryBalances", ledger._id, {
        activeGroupKey: undefined,
      });
  }
  return {
    group: (await ctx.db.get("recoveryGroups", group._id))!,
    isDone: pendingOperations === 0,
  };
}
