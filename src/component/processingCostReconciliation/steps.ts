import { v } from "convex/values";
import { anyApi } from "convex/server";
import { checkRollback } from "./rollback.js";
import { adopt } from "./adoption.js";
import type { FunctionHandle } from "convex/server";
import { observationFailure } from "./validation.js";
import { internalMutation } from "../_generated/server.js";
import { observation, refFields, safeStatus, failure } from "./schema.js";
import {
  read,
  status,
  conflict,
  setFailure,
  reference as referenceFor,
} from "./helpers.js";
import { recordClaim, rollbackClaim } from "../costRecovery/claims.js";
import { calculateProcessingCostDeficit } from "../../client/processingCostDeficit/index.js";
export const apply = internalMutation({
  args: { ...refFields, observation },
  returns: safeStatus,
  handler: async (ctx, args) => {
    const op = await read(ctx, args);
    if (
      op.result ||
      (op.failure &&
        op.failure.status !== "not_ready" &&
        op.failure.status !== "unknown")
    )
      return status(op);
    let claim = await ctx.db
      .query("recoveryClaims")
      .withIndex("by_key", (q) => q.eq("claimKey", op.claimKey))
      .unique();
    const o = args.observation;
    if (
      claim &&
      (claim.accountId !== op.accountId ||
        claim.scopeKey !== op.scopeKey ||
        claim.currency !== op.currency ||
        claim.sourceChargeId !== o.sourceChargeId ||
        claim.sourceGross !== o.gross ||
        claim.sourceProcessingFee !== o.originalProcessingFee)
    )
      return setFailure(ctx, op, conflict("identity_changed"));
    if ((claim?.revision ?? -1) !== op.expectedRevision) {
      const failure = conflict("revision_changed");
      await ctx.db.patch("processingCostReconciliationOperations", op._id, {
        status: "conflict",
        failure,
      });
      return { ...referenceFor(op), ...failure };
    }
    if (
      o.paymentIntentId !== op.source.paymentIntentId ||
      o.gross !== op.source.gross ||
      o.currency !== op.currency
    )
      throw new Error("Processing-cost source identity does not match.");
    const rollbackCheck = await checkRollback(ctx, op, o);
    if (rollbackCheck.status !== "ready")
      return setFailure(ctx, op, rollbackCheck);
    const original = await ctx.db
      .query("processingCostReconciliationOperations")
      .withIndex("by_claim_status", (q) =>
        q.eq("claimKey", op.claimKey).eq("status", "completed"),
      )
      .order("asc")
      .first();
    const invalid = observationFailure(op, o, original);
    if (invalid) return setFailure(ctx, op, invalid);
    const deficit = calculateProcessingCostDeficit({
      currency: o.currency,
      gross: o.gross,
      ...op.policy,
      processingFee: o.processingFee,
      principalReturned: o.principalReturned,
      disputeFees: o.disputeFees,
    });
    if (!claim && op.importHook) {
      claim = await adopt(ctx, op, o);
      if ((await checkRollback(ctx, op, o)).status !== "ready")
        throw new Error("Processing-cost import changed the rollback state.");
    }
    if (rollbackCheck.bindFunding && op.rollback)
      await ctx.runMutation(anyApi.costRecovery.mutations.bindInvoiceFunding, {
        groupKey: op.rollback.groupKey,
        sourceChargeId: o.sourceChargeId,
        sourceGross: o.gross,
        sourceProcessingFee: o.originalProcessingFee,
      });
    const stored = await recordClaim(ctx, {
      accountId: op.accountId,
      scopeKey: op.scopeKey,
      currency: op.currency,
      claimKey: op.claimKey,
      sourceChargeId: o.sourceChargeId,
      sourceGross: o.gross,
      sourceProcessingFee: o.originalProcessingFee,
      amountDue: deficit.amountDue,
      revision: (claim?.revision ?? -1) + 1,
    });
    const rolledBack = op.rollback
      ? await rollbackClaim(ctx, {
          groupKey: op.rollback.groupKey,
          returnedPrincipal: o.principalReturned,
          revision: op.rollback.expectedRevision + 1,
        })
      : undefined;
    const result = {
      claim: stored,
      ...(rolledBack ? { rollbackClaim: rolledBack } : {}),
      deficit,
      observation: o,
    };
    const completed = {
      ...referenceFor(op),
      status: "completed" as const,
      result,
    };
    if (op.projection) {
      try {
        await ctx.runMutation(
          op.projection as FunctionHandle<"mutation">,
          completed,
        );
      } catch {
        throw new Error("Processing-cost projection failed.");
      }
    }
    await ctx.db.patch("processingCostReconciliationOperations", op._id, {
      status: "completed",
      result,
      failure: undefined,
    });
    return completed;
  },
});
export const begin = internalMutation({
  args: refFields,
  returns: v.null(),
  handler: async (ctx, args) => {
    const op = await read(ctx, args);
    if (
      !op.result &&
      (!op.failure ||
        op.failure.status === "not_ready" ||
        op.failure.status === "unknown")
    )
      await ctx.db.patch("processingCostReconciliationOperations", op._id, {
        status: "running",
        failure: undefined,
      });
    return null;
  },
});
export const unavailable = internalMutation({
  args: { ...refFields, outcome: failure },
  returns: safeStatus,
  handler: async (ctx, args) => {
    const op = await read(ctx, args);
    if (
      op.result ||
      (op.failure && ["conflict", "rejected"].includes(op.failure.status))
    )
      return status(op);
    return setFailure(ctx, op, args.outcome);
  },
});
