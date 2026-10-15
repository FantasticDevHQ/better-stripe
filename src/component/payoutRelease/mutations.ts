import { v } from "convex/values";
import { mutation } from "../_generated/server.js";
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
    providerAvailable: v.number(),
    independentLiabilities: v.number(),
    observations: v.array(observation),
  },
  returns: v.union(claimDoc, held),
  handler: async (ctx, args) => {
    validateIdentity(args);
    const existing = await claimByKey(ctx, args);
    if (existing) {
      if (
        existing.currency !== args.currency ||
        existing.expectedRevision !== args.expectedRevision
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
    const plan = planRecipientPayout({
      currency: args.currency,
      threshold: minimum.amount,
      providerAvailable: args.providerAvailable,
      independentLiabilities: args.independentLiabilities,
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
      allocations: plan.allocations,
      observations: args.observations,
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
  },
  returns: claimDoc,
  handler: async (ctx, args) => {
    const claim = await claimByKey(ctx, args);
    if (
      !claim ||
      claim.attemptedAt === undefined ||
      claim.status === "canceled"
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
      return claim;
    }
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
