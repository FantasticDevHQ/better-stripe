import { v } from "convex/values";
import { mutation } from "../_generated/server.js";
import {
  finalAttemptStartsAt,
  nextPayoutAttempt,
} from "../payoutRelease/deadline.js";
import { readPolicy } from "../payoutPolicy/helpers.js";
import { claimByKey, add } from "../payoutRelease/helpers.js";
import { balance as recoveryBalance } from "../affiliateRecovery/accounting.js";
import { readJob, validate } from "./helpers.js";
import { scope, jobDoc } from "./schema.js";
const held = v.object({
  status: v.literal("held"),
  reason: v.string(),
  nextAttemptAt: v.optional(v.number()),
});
/** A worker lease serializes observations; only the payout claim reserves money. */
export const begin = mutation({
  args: { ...scope, cadenceMs: v.number() },
  returns: v.union(
    held,
    v.object({
      status: v.literal("run"),
      job: jobDoc,
      reconcileOnly: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    validate(args);
    if (
      !Number.isSafeInteger(args.cadenceMs) ||
      args.cadenceMs < 60000 ||
      args.cadenceMs > 86400000
    )
      throw new Error("Worker cadence must be between one minute and one day.");
    const policy = await readPolicy(ctx, args);
    let job = await readJob(ctx, args);
    const now = Date.now();
    if (job?.leaseUntil && job.leaseUntil > now)
      return {
        status: "held" as const,
        reason: "worker_busy",
        nextAttemptAt: job.leaseUntil,
      };
    const finalStart = finalAttemptStartsAt(policy);
    const enteringFinalWindow =
      policy?.mode === "custom" &&
      policy.status === "ready" &&
      finalStart !== undefined &&
      finalStart <= now &&
      policy.holdDeadline! > now &&
      (job?.lastAttemptAt ?? 0) < finalStart;
    if (job && job.nextAttemptAt > now && !enteringFinalWindow)
      return {
        status: "held" as const,
        reason: "not_due",
        nextAttemptAt: job.nextAttemptAt,
      };
    const claim = job?.operationKey
      ? await claimByKey(ctx, { ...args, operationKey: job.operationKey })
      : null;
    if (claim && claim.currency !== args.currency)
      throw new Error("Worker payout currency changed.");
    const unresolved =
      claim?.status === "reserved" || claim?.status === "submitted";
    if (
      !unresolved &&
      (policy?.mode !== "custom" ||
        policy.status !== "ready" ||
        !policy.holdDeadline ||
        policy.holdDeadline <= now ||
        !policy.thresholds.some((t) => t.currency === args.currency))
    ) {
      if (job)
        await ctx.db.patch("payoutWorkerJobs", job._id, {
          operationKey: undefined,
          hasOperation: false,
          leaseUntil: undefined,
          lastReason: "policy_inactive",
          lastResultAt: now,
          nextAttemptAt: nextPayoutAttempt(policy, now, args.cadenceMs),
        });
      return { status: "held" as const, reason: "policy_inactive" };
    }
    if (!job) {
      const id = await ctx.db.insert("payoutWorkerJobs", {
        accountId: args.accountId,
        ownerKey: args.ownerKey,
        currency: args.currency,
        generation: 0,
        sequence: 0,
        cadenceMs: args.cadenceMs,
        nextAttemptAt: now,
        hasOperation: false,
      });
      job = (await ctx.db.get("payoutWorkerJobs", id))!;
    }
    if (!unresolved) {
      const recovery = await recoveryBalance(
        ctx,
        args.accountId,
        args.currency,
      );
      if (
        recovery &&
        (recovery.outstandingDebt > 0 ||
          recovery.reservedRecovery > 0 ||
          recovery.reservedRestoration > 0 ||
          recovery.activePayoutKey)
      ) {
        const nextAttemptAt = nextPayoutAttempt(policy, now, args.cadenceMs);
        await ctx.db.patch("payoutWorkerJobs", job._id, {
          operationKey: undefined,
          hasOperation: false,
          leaseUntil: undefined,
          lastReason: "affiliate_recovery_pending",
          lastResultAt: now,
          nextAttemptAt,
        });
        return {
          status: "held" as const,
          reason: "affiliate_recovery_pending",
          nextAttemptAt,
        };
      }
    }
    // A lost response with no claim is safe to resume at the same operation ID.
    // A retained attempted claim always reconciles, including after opt-out.
    const retain = job.operationKey && (!claim || unresolved);
    const sequence = retain ? job.sequence : add(job.sequence, 1);
    const operationKey = retain
      ? job.operationKey!
      : `bs:auto:${job._id}:${sequence}`;
    await ctx.db.patch("payoutWorkerJobs", job._id, {
      generation: add(job.generation, 1),
      sequence,
      operationKey,
      hasOperation: true,
      cadenceMs: args.cadenceMs,
      leaseUntil: now + 600000,
      lastAttemptAt: now,
    });
    return {
      status: "run" as const,
      job: (await ctx.db.get("payoutWorkerJobs", job._id))!,
      reconcileOnly: unresolved && claim.attemptedAt !== undefined,
    };
  },
});
export const finish = mutation({
  args: {
    ...scope,
    generation: v.number(),
    operationKey: v.string(),
    reason: v.string(),
  },
  returns: jobDoc,
  handler: async (ctx, args) => {
    const job = await readJob(ctx, args);
    if (
      job?.generation === args.generation &&
      job.completedGeneration === args.generation
    ) {
      if (
        job.completedOperationKey !== args.operationKey ||
        job.lastReason !== args.reason
      )
        throw new Error("Payout worker result cannot be changed.");
      return job;
    }
    if (
      !job ||
      job.generation !== args.generation ||
      job.operationKey !== args.operationKey
    )
      throw new Error("Payout worker generation changed.");
    if (!args.reason || args.reason.length > 120 || /[\r\n]/.test(args.reason))
      throw new Error("Invalid worker result reason.");
    const claim = await claimByKey(ctx, args);
    if (claim && claim.currency !== job.currency)
      throw new Error("Worker payout currency changed.");
    const retain =
      args.reason === "collection_pending" ||
      claim?.status === "reserved" ||
      claim?.status === "submitted";
    await ctx.db.patch("payoutWorkerJobs", job._id, {
      operationKey: retain ? job.operationKey : undefined,
      hasOperation: retain,
      leaseUntil: undefined,
      nextAttemptAt: nextPayoutAttempt(
        await readPolicy(ctx, args),
        Date.now(),
        job.cadenceMs,
      ),
      lastReason: args.reason,
      lastResultAt: Date.now(),
      completedGeneration: args.generation,
      completedOperationKey: args.operationKey,
    });
    return (await ctx.db.get("payoutWorkerJobs", job._id))!;
  },
});
