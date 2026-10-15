import { v, type Infer } from "convex/values";
import type { MutationCtx } from "../_generated/server.js";
import { importArgs } from "./schema.js";
import { recordClaim } from "./claims.js";
import { adjustTotals, balance, integer, sign } from "./helpers.js";
const _argsValidator = v.object(importArgs);
/** The host verifies historical collection; this operation performs no provider IO. */
export async function importOpeningClaim(
  ctx: MutationCtx,
  args: Infer<typeof _argsValidator>,
) {
  integer(args.collectedAmount);
  if (!args.operationKey.trim() || args.claimKey.startsWith("rollback:"))
    throw new Error("Invalid recovery import identity.");
  const imported = await ctx.db
    .query("recoveryClaims")
    .withIndex("by_import", (q) =>
      q.eq("openingCollection.operationKey", args.operationKey),
    )
    .unique();
  if (imported && imported.claimKey !== args.claimKey)
    throw new Error("Recovery import identity cannot change.");
  const existing = await ctx.db
    .query("recoveryClaims")
    .withIndex("by_key", (q) => q.eq("claimKey", args.claimKey))
    .unique();
  const openingCollection = {
    operationKey: args.operationKey,
    amountDue: args.amountDue,
    revision: args.revision,
    collectedAmount: args.collectedAmount,
  };
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
        throw new Error("Recovery import source identity cannot change.");
    if (!existing.openingCollection)
      throw new Error("Cannot import over an existing live recovery claim.");
    for (const key of [
      "operationKey",
      "amountDue",
      "revision",
      "collectedAmount",
    ] as const)
      if (existing.openingCollection[key] !== openingCollection[key])
        throw new Error("Recovery opening snapshot cannot change.");
    return existing;
  }
  if ((await balance(ctx, args)).activeGroupKey)
    throw new Error(
      "Cannot import while another recovery boundary is pending.",
    );
  const { operationKey: _operationKey, collectedAmount, ...observation } = args;
  const claim = await recordClaim(ctx, observation);
  const outstanding = integer(claim.amountDue - collectedAmount);
  await ctx.db.patch("recoveryClaims", claim._id, {
    collectedAmount,
    outstanding,
    sign: sign(outstanding),
    openingCollection,
  });
  await adjustTotals(ctx, args, {
    collectedAmount,
    outstanding: -collectedAmount,
  });
  return (await ctx.db.get("recoveryClaims", claim._id))!;
}
