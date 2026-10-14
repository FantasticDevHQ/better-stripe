import { v } from "convex/values";
import { type MutationCtx } from "../_generated/server.js";
import { observationFields, rollbackArgs } from "./schema.js";
import {
  adjustTotals,
  getGroup,
  integer,
  sign,
  validateScope,
} from "./helpers.js";
import type { Infer } from "convex/values";
const _observation = v.object(observationFields);
export async function recordClaim(
  ctx: MutationCtx,
  args: Infer<typeof _observation>,
) {
  validateScope(args);
  [
    args.amountDue,
    args.sourceGross,
    args.sourceProcessingFee,
    args.revision,
  ].forEach(integer);
  if (
    !args.claimKey ||
    !args.sourceChargeId ||
    args.sourceGross <= 0 ||
    args.sourceProcessingFee < 0 ||
    args.revision < 0
  )
    throw new Error("Invalid recovery claim observation.");
  const existing = await ctx.db
    .query("recoveryClaims")
    .withIndex("by_key", (q) => q.eq("claimKey", args.claimKey))
    .unique();
  if (existing) {
    for (const key of [
      "accountId",
      "scopeKey",
      "currency",
      "sourceChargeId",
      "sourceGross",
      "sourceProcessingFee",
    ] as const)
      if (existing[key] !== args[key])
        throw new Error("Recovery claim source identity cannot change.");
    if (args.revision < existing.revision) return existing;
    if (args.revision === existing.revision) {
      if (args.amountDue !== existing.amountDue)
        throw new Error(
          "Recovery revision cannot be reused with a different amount.",
        );
      return existing;
    }
  }
  const delta = integer(args.amountDue - (existing?.amountDue ?? 0));
  const collectedAmount = existing?.collectedAmount ?? 0,
    reservedAmount = existing?.reservedAmount ?? 0;
  const outstanding = integer(
    args.amountDue - collectedAmount - reservedAmount,
  );
  const fields = {
    ...args,
    collectedAmount,
    reservedAmount,
    outstanding,
    sign: sign(outstanding),
  };
  let id = existing?._id;
  if (id) await ctx.db.patch("recoveryClaims", id, fields);
  else id = await ctx.db.insert("recoveryClaims", fields);
  await adjustTotals(ctx, args, { amountDue: delta, outstanding: delta });
  return (await ctx.db.get("recoveryClaims", id))!;
}

const _rollbackArgs = v.object(rollbackArgs);
export async function rollbackClaim(
  ctx: MutationCtx,
  args: Infer<typeof _rollbackArgs>,
) {
  integer(args.returnedPrincipal);
  integer(args.revision);
  const group = await getGroup(ctx, args.groupKey);
  if (
    group.status !== "collected" ||
    group.sourceKind !== "settlement" ||
    !group.sourceGross
  )
    throw new Error(
      "Rollback requires a collected settlement group with original funding economics.",
    );
  if (args.returnedPrincipal < 0 || args.returnedPrincipal > group.sourceGross)
    throw new Error("Returned principal exceeds the original funding sale.");
  const abs = BigInt(Math.abs(group.amount)),
    gross = BigInt(group.sourceGross),
    principal = BigInt(args.returnedPrincipal);
  const rounded = Number((abs * principal + gross / 2n) / gross);
  return recordClaim(ctx, {
    accountId: group.accountId,
    scopeKey: group.scopeKey,
    currency: group.currency,
    claimKey: `rollback:${group.groupKey}`,
    sourceChargeId: group.sourceId,
    sourceGross: group.sourceGross,
    sourceProcessingFee: group.sourceProcessingFee!,
    amountDue: group.amount < 0 ? -rounded : rounded,
    revision: args.revision,
  });
}
