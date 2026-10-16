import { outcomeArgs, recordPayoutOutcome } from "./outcome.js";
import {
  collectedSources,
  bindCollection,
  retireCollection,
} from "../payoutSnapshots/financial.js";
import {
  reserveRecoveryGuard,
  releaseRecoveryGuard,
} from "../affiliatePayouts/recipientGuard.js";
import {
  historicalBatchArgs,
  adoptHistoricalBatch as importHistoricalBatch,
} from "./adoption.js";
import { readFees } from "./fees.js";
import { v } from "convex/values";
import { mutation } from "../earnings/triggers.js";
import { identity, observation, claimDoc } from "./schema.js";
import {
  claimByKey,
  readyPolicy,
  checkSnapshot,
  sourceById,
  moveAllocations,
  validateIdentity,
  add,
} from "./helpers.js";
import { readPayoutPlan } from "./planning.js";
const held = v.object({
  status: v.literal("held"),
  reason: v.union(
    v.literal("below_threshold"),
    v.literal("insufficient_available"),
    v.literal("pending_claim"),
  ),
  amount: v.literal(0),
  matureUnpaid: v.optional(v.number()),
  pendingCredits: v.optional(v.number()),
  currency: v.string(),
  providerMinimum: v.null(),
});
/** Trusted server package boundary only: provider observations are verified upstream. Not a Stripe executor. */
export const claim = mutation({
  args: {
    ...identity,
    expectedRevision: v.number(),
    currency: v.string(),
    destinationId: v.optional(v.string()),
    providerAvailable: v.number(),
    independentLiabilities: v.number(),
    observations: v.array(observation),
    snapshotId: v.optional(v.id("payoutSnapshots")),
    liabilityRevision: v.optional(v.number()),
  },
  returns: v.union(claimDoc, held),
  handler: async (ctx, args) => {
    validateIdentity(args);
    if (
      args.destinationId !== undefined &&
      !/^ba_\w+$/.test(args.destinationId)
    )
      throw new Error("Invalid payout bank destination.");
    const existing = await claimByKey(ctx, args);
    if (existing) {
      if (
        existing.currency !== args.currency ||
        existing.expectedRevision !== args.expectedRevision ||
        existing.destinationId !== args.destinationId
      )
        throw new Error("Payout claim identity cannot be reused.");
      return existing;
    }
    const policy = await readyPolicy(ctx, args);
    const pending = await ctx.db
      .query("payoutReleaseClaims")
      .withIndex("by_account_status", (q) =>
        q.eq("accountId", args.accountId).eq("status", "reserved"),
      )
      .first();
    if (pending)
      return {
        status: "held" as const,
        reason: "pending_claim" as const,
        amount: 0 as const,
        currency: args.currency,
        providerMinimum: null,
      };
    const { plan, fees } = await readPayoutPlan(ctx, args, policy);
    if (plan.status === "held") return plan;
    await reserveRecoveryGuard(ctx, args, plan.amount);
    for (const allocation of plan.allocations) {
      const prior = await sourceById(ctx, allocation.stripeTransferId);
      if (prior)
        await ctx.db.patch("payoutSourceAllocations", prior._id, {
          reservedAmount: add(prior.reservedAmount, allocation.amount),
        });
      else
        await ctx.db.insert("payoutSourceAllocations", {
          accountId: args.accountId,
          ownerKey: args.ownerKey,
          stripeTransferId: allocation.stripeTransferId,
          currency: args.currency,
          paidAmount: 0,
          reservedAmount: allocation.amount,
        });
    }
    const id = await ctx.db.insert("payoutReleaseClaims", {
      accountId: args.accountId,
      ownerKey: args.ownerKey,
      operationKey: args.operationKey,
      expectedRevision: args.expectedRevision,
      currency: args.currency,
      amount: plan.amount,
      ...(args.destinationId ? { destinationId: args.destinationId } : {}),
      allocations: plan.allocations,
      observations: args.observations,
      independentLiabilities: args.independentLiabilities,
      ...(args.snapshotId ? { snapshotId: args.snapshotId } : {}),
      ...(args.liabilityRevision === undefined
        ? {}
        : { liabilityRevision: args.liabilityRevision }),
      feeRevision: fees?.revision ?? 0,
      status: "reserved",
    });
    const claim = (await ctx.db.get("payoutReleaseClaims", id))!;
    await bindCollection(ctx, claim);
    return claim;
  },
});
export const beginAttempt = mutation({
  args: identity,
  returns: claimDoc,
  handler: async (ctx, args) => {
    const claim = await claimByKey(ctx, args);
    if (!claim || claim.status !== "reserved")
      throw new Error("Payout claim is not reserved.");
    if (claim.attemptedAt !== undefined) return claim;
    await readyPolicy(ctx, claim);
    const feeRevision = (await readFees(ctx, claim))?.revision ?? 0;
    if (feeRevision !== (claim.feeRevision ?? 0))
      throw new Error("Payout fee revision changed after reservation.");
    await checkSnapshot(
      ctx,
      claim.accountId,
      claim.observations,
      true,
      claim.currency,
      (await collectedSources(ctx, claim, claim.observations))?.transfers,
    );
    await reserveRecoveryGuard(ctx, claim, claim.amount);
    await ctx.db.patch("payoutReleaseClaims", claim._id, {
      attemptedAt: Date.now(),
    });
    await retireCollection(ctx, claim);
    return (await ctx.db.get("payoutReleaseClaims", claim._id))!;
  },
});
export const cancelUnattempted = mutation({
  args: identity,
  returns: claimDoc,
  handler: async (ctx, args) => {
    const claim = await claimByKey(ctx, args);
    if (
      !claim ||
      claim.attemptedAt !== undefined ||
      (claim.status !== "reserved" && claim.status !== "canceled")
    )
      throw new Error("An attempted payout claim cannot be canceled.");
    if (claim.status === "canceled") return claim;
    await moveAllocations(ctx, claim, "release");
    await retireCollection(ctx, claim);
    await releaseRecoveryGuard(ctx, claim);
    await ctx.db.patch("payoutReleaseClaims", claim._id, {
      status: "canceled",
    });
    return (await ctx.db.get("payoutReleaseClaims", claim._id))!;
  },
});
export const recordOutcome = mutation({
  args: outcomeArgs,
  returns: claimDoc,
  handler: recordPayoutOutcome,
});
/** Bounded atomic reconciliation; every row retains the single-outcome validation. */
export const recordOutcomes = mutation({
  args: {
    accountId: v.string(),
    ownerKey: v.string(),
    outcomes: v.array(outcomeArgs),
  },
  returns: v.array(claimDoc),
  handler: async (ctx, args) => {
    if (
      !args.outcomes.length ||
      args.outcomes.length > 25 ||
      new Set(args.outcomes.map((o) => o.operationKey)).size !==
        args.outcomes.length
    )
      throw new Error("Invalid payout outcome batch.");
    const results = [];
    for (const outcome of args.outcomes) {
      if (
        outcome.accountId !== args.accountId ||
        outcome.ownerKey !== args.ownerKey
      )
        throw new Error("Payout outcome batch ownership changed.");
      results.push(await recordPayoutOutcome(ctx, outcome));
    }
    return results;
  },
});

/** Only a verified, no-object rejection within the original idempotency window. */
export const recordRejection = mutation({
  args: {
    ...identity,
    requestId: v.string(),
    code: v.union(
      v.literal("balance_insufficient"),
      v.literal("amount_too_small"),
    ),
  },
  returns: claimDoc,
  handler: async (ctx, args) => {
    const claim = await claimByKey(ctx, args);
    if (
      !claim ||
      !/^req_\w+$/.test(args.requestId) ||
      args.requestId.trim() !== args.requestId
    )
      throw new Error("Invalid payout rejection receipt.");
    if (claim.status === "rejected") {
      if (
        claim.rejection?.requestId !== args.requestId ||
        claim.rejection.code !== args.code
      )
        throw new Error("Payout rejection receipt identity changed.");
      return claim;
    }
    if (
      claim.status !== "reserved" ||
      claim.stripePayoutId ||
      claim.attemptedAt === undefined ||
      Date.now() - claim.attemptedAt >= 23 * 60 * 60 * 1000
    )
      throw new Error(
        "An accepted or uncertain expired payout attempt cannot be released as a rejection.",
      );
    const adoptedRejection = await ctx.db
      .query("payoutReleaseClaims")
      .withIndex("by_rejection_request", (q) =>
        q.eq("rejection.requestId", args.requestId),
      )
      .unique();
    if (adoptedRejection && adoptedRejection._id !== claim._id)
      throw new Error("Payout rejection receipt is already allocated.");
    await moveAllocations(ctx, claim, "release");
    await releaseRecoveryGuard(ctx, claim);
    await ctx.db.patch("payoutReleaseClaims", claim._id, {
      status: "rejected",
      rejection: { requestId: args.requestId, code: args.code },
    });
    return (await ctx.db.get("payoutReleaseClaims", claim._id))!;
  },
});

export const adoptHistoricalBatch = mutation({
  args: historicalBatchArgs,
  returns: v.object({ claims: v.array(claimDoc) }),
  handler: importHistoricalBatch,
});
