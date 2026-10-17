import { v } from "convex/values";
import { mutation } from "../earnings/triggers.js";
import { writeRefund } from "../connect/refundWrites.js";
import {
  claimByRefund,
  refundById,
  validateIdentity,
  validateSnapshot,
  assertOriginal,
  fingerprint,
} from "./helpers.js";
import { refundRouting } from "./routing.js";
import { identity, prepared, result } from "./validators.js";

/** Failed first reads cannot permanently claim an unverified provider API namespace. */
export const begin = mutation({
  args: identity,
  returns: v.number(),
  handler: async (ctx, args) => {
    validateIdentity(args);
    const claim = await claimByRefund(ctx, args.stripeRefundId);
    await refundById(ctx, args.stripeRefundId);
    if (
      claim?.acceptedContext !== undefined &&
      claim.acceptedContext !== args.apiContext
    )
      throw new Error("Accepted refund API context does not match.");
    const generation = (claim?.generation ?? 0) + 1;
    if (!Number.isSafeInteger(generation) || generation <= 0)
      throw new Error("Refund synchronization generation exhausted.");
    const fields = {
      generation,
      requestedContext: args.apiContext,
      status: "pending" as const,
      startedAt: Date.now(),
    };
    if (claim) await ctx.db.patch("refundSyncClaims", claim._id, fields);
    else
      await ctx.db.insert("refundSyncClaims", {
        stripeRefundId: args.stripeRefundId,
        ...fields,
      });
    return generation;
  },
});

/** Accept the qualified observation and unchanged financial writer atomically. */
export const finish = mutation({
  args: prepared,
  returns: result,
  handler: async (ctx, args) => {
    validateIdentity(args);
    if (!Number.isSafeInteger(args.generation) || args.generation <= 0)
      throw new Error("Invalid refund synchronization generation.");
    const claim = await claimByRefund(ctx, args.stripeRefundId);
    if (!claim) throw new Error("Refund synchronization claim is missing.");
    if (claim.generation !== args.generation)
      return { status: "superseded" as const, generation: args.generation };
    if (
      claim.requestedContext !== args.apiContext ||
      (claim.acceptedContext !== undefined &&
        claim.acceptedContext !== args.apiContext)
    )
      throw new Error("Refund synchronization API context does not match.");
    validateSnapshot(args.refund);
    if (args.refund.stripeRefundId !== args.stripeRefundId)
      throw new Error("Refund synchronization identity does not match.");
    const routing = await refundRouting(ctx, args.refund);
    if (
      routing.status === "held" ||
      (routing.merchantAccount !== null &&
        routing.merchantAccount !== args.refund.accountId) ||
      (routing.requiresChargeProof && args.refund.accountId === undefined)
    )
      throw new Error(
        "Original refund merchant is unavailable or contradictory.",
      );
    const existing = await refundById(ctx, args.stripeRefundId);
    assertOriginal(existing, args.refund);
    const nextFingerprint = await fingerprint(args.refund);
    const changed =
      !existing || (await fingerprint(existing)) !== nextFingerprint;
    if (claim.status === "accepted") {
      if (claim.acceptedFingerprint !== nextFingerprint || changed || !existing)
        throw new Error(
          "Accepted refund observation changed outside its generation.",
        );
      return {
        status: "accepted" as const,
        generation: args.generation,
        changed: false,
        refund: existing,
      };
    }
    await writeRefund(ctx, {
      ...args.refund,
      reason: args.refund.reason,
      failureReason: args.refund.failureReason,
    });
    const refund = await refundById(ctx, args.stripeRefundId);
    if (!refund) throw new Error("Accepted refund was not persisted.");
    await ctx.db.patch("refundSyncClaims", claim._id, {
      status: "accepted",
      acceptedContext: args.apiContext,
      acceptedGeneration: args.generation,
      acceptedAt: Date.now(),
      acceptedFingerprint: nextFingerprint,
    });
    return {
      status: "accepted" as const,
      generation: args.generation,
      changed,
      refund,
    };
  },
});
export const markUnknown = mutation({
  args: { ...identity, generation: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    validateIdentity(args);
    const claim = await claimByRefund(ctx, args.stripeRefundId);
    if (
      claim?.generation === args.generation &&
      claim.requestedContext === args.apiContext &&
      claim.status === "pending"
    )
      await ctx.db.patch("refundSyncClaims", claim._id, { status: "unknown" });
    return null;
  },
});
