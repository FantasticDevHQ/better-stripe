import { anyApi } from "convex/server";
import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { stripe } from "../../stripe/helpers";
import { costScope } from "../../sellerCosts/recovery";
import { jobReference, readJob } from "../../sellerCosts/workflow/helpers";
import { operationRefFields } from "../../sellerCosts/workflow/validators";
import { prepareSaleRecovery } from "../recovery";
import {
  projectSaleMirrors,
  verifiedSaleTransferUpdates,
  projectSalePayment,
  saleAllocation,
} from "./helpers";
export const start = internalMutation({
  args: { saleId: v.id("storeSales") },
  returns: v.any(),
  handler: async (ctx, args) => {
    let sale = await ctx.db.get("storeSales", args.saleId);
    if (!sale) throw new Error("Sale is unavailable.");
    const seller = await ctx.db.get("users", sale.sellerId);
    if (
      seller?.role !== "seller" ||
      seller.stripeAccountId !== sale.sellerAccountId
    )
      throw new Error("Original sale owner changed.");
    if (sale.status !== "pending") return null;
    sale = await prepareSaleRecovery(ctx, sale);
    if (!sale.recoveryReady) {
      await ctx.scheduler.runAfter(
        0,
        anyApi.settlement.workflow.mutations.start,
        args,
      );
      return { status: "preparing" };
    }
    // Another invoice owns this scope's recovery. Keep the existing zero-owned-recovery payout policy.
    if (!sale.recoveryGroupKey) return { status: "no_owned_recovery" };
    const scope = costScope(sale.sellerId, sale.sellerAccountId, sale.currency),
      groupKey = sale.recoveryGroupKey;
    let group = await stripe.costRecovery.getGroup(ctx, { groupKey });
    if (
      !group ||
      group.accountId !== scope.accountId ||
      group.scopeKey !== scope.scopeKey ||
      group.currency !== scope.currency ||
      group.sourceKind !== "settlement" ||
      group.sourceId !== sale.chargeId ||
      group.sourceGross !== sale.gross ||
      group.sourceProcessingFee !== sale.processingFee ||
      group.amount !== (sale.costRecoveryAmount ?? 0)
    )
      throw new Error("Original recovery allocation changed.");
    const requestKey = `example:settlement-workflow:v1:${sale.chargeId}`;
    const job = await ctx.db
      .query("recoveryJobs")
      .withIndex("by_request", (q) => q.eq("requestKey", requestKey))
      .unique();
    if (job?.operationId) {
      const ref = { ...jobReference(job), groupKey };
      const status = await stripe.costRecovery.getGroupOperation(ctx, ref);
      return !["completed", "canceled"].includes(status.status)
        ? stripe.costRecovery.resumeGroup(ctx, ref)
        : status;
    }
    if (group.status === "collecting") {
      await verifiedSaleTransferUpdates(ctx, sale);
      const finished = await stripe.costRecovery.finish(ctx, {
        groupKey,
        outcome: "collect",
      });
      if (!finished.isDone) {
        await ctx.scheduler.runAfter(
          0,
          anyApi.settlement.workflow.mutations.start,
          args,
        );
        return { status: "finishing_legacy" };
      }
      group = finished.group;
    }
    if (group.status === "collected") {
      await projectSaleMirrors(ctx, sale);
      if (job)
        await ctx.db.patch("recoveryJobs", job._id, {
          legacyVerified: true,
          blockedReason: undefined,
        });
      else
        await ctx.db.insert("recoveryJobs", {
          ...scope,
          requestKey,
          sellerId: sale.sellerId,
          kind: "settlement",
          sourceId: sale.chargeId,
          paymentIntentId: sale.paymentIntentId,
          groupKey,
          observedAt: Date.now(),
          legacyVerified: true,
        });
      return { status: "completed", legacyVerified: true };
    }
    if (
      sale.settlementAttempted ||
      ["collecting", "releasing"].includes(group.status)
    ) {
      if (!job)
        await ctx.db.insert("recoveryJobs", {
          ...scope,
          requestKey,
          sellerId: sale.sellerId,
          kind: "settlement",
          sourceId: sale.chargeId,
          paymentIntentId: sale.paymentIntentId,
          groupKey,
          observedAt: Date.now(),
          blockedReason: "legacy_inflight_unknown",
        });
      return {
        status: "unknown",
        reason: "history_incomplete",
        retryable: false,
      };
    }
    await projectSalePayment(ctx, sale);
    const op = await stripe.costRecovery.startGroup(ctx, {
      ...scope,
      groupKey,
      requestKey,
      allocation: saleAllocation(sale),
      provider: anyApi.settlement.workflow.actions.execute,
      completion: anyApi.settlement.workflow.mutations.complete,
      providerApiVersion: "2026-09-30.endive",
      definitionVersion: 1,
      releaseUncollectible: false,
      maxAttempts: 3,
      retryDelayMs: 1000,
    });
    if ("operationId" in op && !job)
      await ctx.db.insert("recoveryJobs", {
        ...scope,
        requestKey,
        sellerId: sale.sellerId,
        kind: "settlement",
        sourceId: sale.chargeId,
        paymentIntentId: sale.paymentIntentId,
        groupKey,
        observedAt: Date.now(),
        operationId: op.operationId,
        version: op.version,
      });
    return op;
  },
});
export const complete = internalMutation({
  args: {
    ...operationRefFields,
    groupKey: v.string(),
    sourceKind: v.union(v.literal("settlement"), v.literal("invoice")),
    sourceId: v.string(),
    status: v.string(),
    cancelRequested: v.boolean(),
    outcome: v.optional(v.union(v.literal("collect"), v.literal("release"))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await readJob(ctx, args);
    if (
      job.kind !== "settlement" ||
      args.sourceKind !== "settlement" ||
      job.sourceId !== args.sourceId ||
      job.groupKey !== args.groupKey ||
      args.status !== "completed"
    )
      throw new Error("Completed settlement ownership changed.");
    const sale = await ctx.db
      .query("storeSales")
      .withIndex("by_charge", (q) => q.eq("chargeId", job.sourceId))
      .first();
    if (
      !sale ||
      sale.sellerId !== job.sellerId ||
      sale.sellerAccountId !== job.accountId ||
      sale.currency !== job.currency
    )
      throw new Error("Original sale ownership changed.");
    if (args.outcome !== "collect")
      throw new Error(
        "Settlement completion has no verified collection outcome.",
      );
    await projectSaleMirrors(ctx, sale);
    return null;
  },
});
export const authorizeProvider = internalMutation({
  args: operationRefFields,
  returns: v.union(v.literal("execute"), v.literal("hold")),
  handler: async (ctx, args) => {
    const job = await readJob(ctx, args);
    if (job.kind !== "settlement")
      throw new Error("Settlement operation kind changed.");
    const sale = await ctx.db
      .query("storeSales")
      .withIndex("by_charge", (q) => q.eq("chargeId", job.sourceId))
      .first();
    if (
      !sale ||
      sale.sellerId !== job.sellerId ||
      sale.sellerAccountId !== job.accountId ||
      sale.currency !== job.currency
    )
      throw new Error("Original sale ownership changed.");
    if (
      sale.status === "refunded" &&
      !sale.settlementAttempted &&
      !sale.sellerTransferId &&
      !sale.affiliateTransferId
    )
      return "hold";
    if (sale.status === "refunded" && !sale.settlementAttempted)
      throw new Error("Settlement outcome is unresolved.");
    await ctx.db.patch("storeSales", sale._id, { settlementAttempted: true });
    return "execute";
  },
});
