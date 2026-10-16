import { v, type Infer } from "convex/values";
import type { MutationCtx } from "../_generated/server.js";
import { identity } from "./schema.js";
import { claimByKey, moveAllocations } from "./helpers.js";
import { recordFees } from "./fees.js";
import { releaseRecoveryGuard } from "../affiliatePayouts/recipientGuard.js";

export const outcomeArgs = v.object({
  ...identity,
  stripePayoutId: v.string(),
  amount: v.number(),
  currency: v.string(),
  providerStatus: v.union(
    v.literal("pending"),
    v.literal("in_transit"),
    v.literal("paid"),
    v.literal("failed"),
    v.literal("canceled"),
  ),
  returnTransactionId: v.optional(v.string()),
  debitTransactionId: v.optional(v.string()),
  debitFee: v.optional(v.number()),
  returnFee: v.optional(v.number()),
});
export async function recordPayoutOutcome(
  ctx: MutationCtx,
  args: Infer<typeof outcomeArgs>,
) {
  const claim = await claimByKey(ctx, args);
  if (
    !claim ||
    claim.attemptedAt === undefined ||
    claim.status === "canceled" ||
    claim.status === "rejected"
  )
    throw new Error("Payout receipt has no attempted claim.");
  if (
    !/^po_\w+$/.test(args.stripePayoutId) ||
    args.stripePayoutId.trim() !== args.stripePayoutId ||
    args.currency !== claim.currency ||
    args.amount !== claim.amount ||
    (claim.stripePayoutId !== undefined &&
      claim.stripePayoutId !== args.stripePayoutId)
  )
    throw new Error("Payout receipt identity or amount does not match.");
  const adopted = await ctx.db
    .query("payoutReleaseClaims")
    .withIndex("by_provider_payout", (q) =>
      q.eq("stripePayoutId", args.stripePayoutId),
    )
    .unique();
  if (adopted && adopted._id !== claim._id)
    throw new Error("Payout receipt identity is already allocated.");
  if (
    args.returnTransactionId !== undefined &&
    (!/^txn_\w+$/.test(args.returnTransactionId) ||
      args.returnTransactionId.trim() !== args.returnTransactionId)
  )
    throw new Error("Invalid payout return receipt identity.");
  const returned =
    (args.providerStatus === "failed" || args.providerStatus === "canceled") &&
    args.returnTransactionId !== undefined;
  if (returned) {
    const adoptedReturn = await ctx.db
      .query("payoutReleaseClaims")
      .withIndex("by_return_receipt", (q) =>
        q.eq("returnTransactionId", args.returnTransactionId),
      )
      .unique();
    if (adoptedReturn && adoptedReturn._id !== claim._id)
      throw new Error("Payout return receipt is already allocated.");
  }
  if (claim.status === "returned") {
    if (returned && args.returnTransactionId !== claim.returnTransactionId)
      throw new Error("Payout return receipt identity changed.");
    if (returned) {
      await recordFees(ctx, claim, args, true);
      return (await ctx.db.get("payoutReleaseClaims", claim._id))!;
    }
    return claim;
  }
  if (claim.status === "paid" && args.providerStatus !== "paid" && !returned)
    return claim;
  await recordFees(ctx, claim, args, returned);
  await releaseRecoveryGuard(ctx, claim);
  if (
    claim.status === "paid" &&
    args.providerStatus === "paid" &&
    args.debitTransactionId !== undefined &&
    claim.debitTransactionId === args.debitTransactionId &&
    claim.debitFee === args.debitFee &&
    claim.providerFee === args.debitFee
  )
    return claim;
  if (returned) {
    await moveAllocations(
      ctx,
      claim,
      claim.status === "paid" ? "return" : "release",
    );
    await ctx.db.patch("payoutReleaseClaims", claim._id, {
      status: "returned",
      stripePayoutId: args.stripePayoutId,
      returnTransactionId: args.returnTransactionId,
    });
  } else if (args.providerStatus === "paid" && claim.status !== "paid") {
    await moveAllocations(ctx, claim, "pay");
    await ctx.db.patch("payoutReleaseClaims", claim._id, {
      status: "paid",
      stripePayoutId: args.stripePayoutId,
    });
  } else if (claim.status !== "paid") {
    await ctx.db.patch("payoutReleaseClaims", claim._id, {
      status: "submitted",
      stripePayoutId: args.stripePayoutId,
    });
  }
  return (await ctx.db.get("payoutReleaseClaims", claim._id))!;
}
