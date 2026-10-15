import {
  historicalBatchArgs,
  adoptHistoricalBatch as importHistoricalBatch,
} from "./adoption.js";
import { readFees, recordFees } from "./fees.js";
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
import { planRecipientPayout, type PayoutFundingSource } from "./allocation.js";
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
    const minimum = policy.thresholds.find(
      (value) => value.currency === args.currency,
    );
    if (!minimum) throw new Error("Payout policy currency is not configured.");
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
    const rows = await checkSnapshot(
      ctx,
      args.accountId,
      args.observations,
      true,
    );
    const sources: PayoutFundingSource[] = [];
    for (const observation of args.observations) {
      const prior = await sourceById(ctx, observation.stripeTransferId);
      if (
        prior &&
        (prior.accountId !== args.accountId ||
          prior.ownerKey !== args.ownerKey ||
          prior.currency !== observation.currency)
      )
        throw new Error("Payout source allocation identity changed.");
      sources.push({
        ...observation,
        role: rows.get(observation.stripeTransferId)!.role,
        paidAmount: prior?.paidAmount ?? 0,
        reservedAmount: prior?.reservedAmount ?? 0,
      });
    }
    const fees = await readFees(ctx, args);
    const plan = planRecipientPayout({
      currency: args.currency,
      threshold: minimum.amount,
      providerAvailable: args.providerAvailable,
      independentLiabilities: args.independentLiabilities,
      confirmedFees: fees?.amount ?? 0,
      sources,
    });
    if (plan.status === "held") return plan;
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
      feeRevision: fees?.revision ?? 0,
      status: "reserved",
    });
    return (await ctx.db.get("payoutReleaseClaims", id))!;
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
    await checkSnapshot(ctx, claim.accountId, claim.observations, true);
    await ctx.db.patch("payoutReleaseClaims", claim._id, {
      attemptedAt: Date.now(),
    });
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
    await ctx.db.patch("payoutReleaseClaims", claim._id, {
      status: "canceled",
    });
    return (await ctx.db.get("payoutReleaseClaims", claim._id))!;
  },
});
export const recordOutcome = mutation({
  args: {
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
  },
  returns: claimDoc,
  handler: async (ctx, args) => {
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
      (args.providerStatus === "failed" ||
        args.providerStatus === "canceled") &&
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
