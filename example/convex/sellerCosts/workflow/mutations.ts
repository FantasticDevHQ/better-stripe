import { anyApi } from "convex/server";
import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { stripe } from "../../stripe/helpers";
import { costClaimKey, costScope } from "../recovery";
import { costStartFields, operationRefFields } from "./validators";
import { readJob } from "./helpers";
export const start = internalMutation({
  args: costStartFields,
  returns: v.any(),
  handler: async (ctx, args) => {
    const seller = await ctx.db.get("users", args.sellerId);
    if (seller?.role !== "seller" || !seller.stripeAccountId)
      throw new Error("Original seller account is unavailable.");
    const sale = await ctx.db
      .query("storeSales")
      .withIndex("by_charge", (q) => q.eq("chargeId", args.sourceChargeId))
      .first();
    if (
      sale &&
      (sale.sellerId !== args.sellerId ||
        sale.sellerAccountId !== seller.stripeAccountId ||
        sale.paymentIntentId !== args.paymentIntentId ||
        sale.gross !== args.gross ||
        sale.processingFee !== args.originalProcessingFee ||
        sale.currency !== args.currency ||
        sale.sellingFee !== args.sellingFee)
    )
      throw new Error("Processing costs do not match the original sale.");
    const scope = costScope(
      args.sellerId,
      seller.stripeAccountId,
      args.currency,
    );
    if (sale?.costRecoveryAmount && !sale.recoveryGroupKey) {
      const requestKey = `example:blocked-cost:${args.paymentIntentId}`;
      const prior = await ctx.db
        .query("recoveryJobs")
        .withIndex("by_request", (q) => q.eq("requestKey", requestKey))
        .unique();
      if (!prior)
        await ctx.db.insert("recoveryJobs", {
          ...scope,
          requestKey,
          sellerId: args.sellerId,
          kind: "cost",
          sourceId: args.sourceChargeId,
          paymentIntentId: args.paymentIntentId,
          observedAt: Date.now(),
          sourceType: args.sourceType,
          blockedReason: "legacy_mapping_required",
        });
      return {
        status: "unknown",
        reason: "history_incomplete",
        retryable: false,
      };
    }
    const previous = await stripe.costRecovery.getClaim(ctx, {
      claimKey: costClaimKey(args.paymentIntentId),
    });
    if (
      previous &&
      (previous.accountId !== scope.accountId ||
        previous.scopeKey !== scope.scopeKey ||
        previous.currency !== scope.currency)
    )
      throw new Error("Original claim ownership changed.");
    const rollbackGroupKey =
      args.invoiceRecoveryGroupKey ?? sale?.recoveryGroupKey;
    const group = rollbackGroupKey
      ? await stripe.costRecovery.getGroup(ctx, { groupKey: rollbackGroupKey })
      : null;
    if (
      group &&
      (group.accountId !== scope.accountId ||
        group.scopeKey !== scope.scopeKey ||
        group.currency !== scope.currency)
    )
      throw new Error("Original recovery group ownership changed.");
    if (
      group &&
      group.status !== "collected" &&
      !["released", "open", "sealed"].includes(group.status)
    )
      throw new Error("Original recovery outcome is unresolved.");
    if (
      sale?.settlementAttempted &&
      group &&
      !["collected", "released"].includes(group.status)
    ) {
      const requestKey = `example:blocked-cost:${args.paymentIntentId}`;
      const prior = await ctx.db
        .query("recoveryJobs")
        .withIndex("by_request", (q) => q.eq("requestKey", requestKey))
        .unique();
      const owned = await ctx.db
        .query("recoveryJobs")
        .withIndex("by_request", (q) =>
          q.eq(
            "requestKey",
            `example:settlement-workflow:v1:${args.sourceChargeId}`,
          ),
        )
        .unique();
      if (!prior)
        await ctx.db.insert("recoveryJobs", {
          ...scope,
          requestKey,
          sellerId: args.sellerId,
          kind: "cost",
          sourceId: args.sourceChargeId,
          paymentIntentId: args.paymentIntentId,
          observedAt: Date.now(),
          sourceType: args.sourceType,
          blockedReason: owned?.operationId
            ? "settlement_pending"
            : "legacy_inflight_unknown",
        });
      return {
        status: "unknown",
        reason: "history_incomplete",
        retryable: false,
      };
    }
    const rollback =
      group?.status === "collected"
        ? {
            groupKey: group.groupKey,
            expectedRevision:
              (
                await stripe.costRecovery.getClaim(ctx, {
                  claimKey: `rollback:${group.groupKey}`,
                })
              )?.revision ?? -1,
          }
        : undefined;
    if (args.invoiceRecoveryGroupKey && !rollback)
      throw new Error("Original recovery invoice is not collected.");
    const requestKey = `example:cost-workflow:v1:${args.paymentIntentId}:${previous?.revision ?? -1}:${rollback?.expectedRevision ?? -1}`;
    const priorJob = await ctx.db
      .query("recoveryJobs")
      .withIndex("by_request", (q) => q.eq("requestKey", requestKey))
      .unique();
    const existing = await ctx.db
      .query("sellerCosts")
      .withIndex("by_charge", (q) =>
        q.eq("sourceChargeId", args.sourceChargeId),
      )
      .first();
    const result = await stripe.costRecovery.startProcessingCostReconciliation(
      ctx,
      {
        ...scope,
        claimKey: costClaimKey(args.paymentIntentId),
        requestKey,
        expectedRevision: previous?.revision ?? -1,
        source: args.invoiceRecoveryGroupKey
          ? {
              kind: "invoice_recovery",
              paymentIntentId: args.paymentIntentId,
              gross: args.gross,
              groupKey: args.invoiceRecoveryGroupKey,
            }
          : {
              kind: "sale",
              paymentIntentId: args.paymentIntentId,
              gross: args.gross,
              customerAccountId: args.customerAccountId,
              ...((args.stripePriceId ?? sale?.stripePriceId) !== undefined
                ? { stripePriceId: args.stripePriceId ?? sale?.stripePriceId }
                : {}),
              ...((args.stripeProductId ?? sale?.stripeProductId) !== undefined
                ? {
                    stripeProductId:
                      args.stripeProductId ?? sale?.stripeProductId,
                  }
                : {}),
              ...(args.invoiceId ? { invoiceId: args.invoiceId } : {}),
            },
        policy: {
          sellingFee: args.sellingFee,
          liability: { processingCosts: "uncovered", disputeCosts: "all" },
          rounding: "nearest",
        },
        ...(rollback ? { rollback } : {}),
        provider: anyApi.sellerCosts.workflow.actions.observe,
        projection: anyApi.sellerCosts.workflow.mutations.project,
        importHook: anyApi.sellerCosts.workflow.mutations.importOpening,
        providerApiVersion: "2026-09-30.endive",
        definitionVersion: 1,
        maxAttempts: 3,
        retryDelayMs: 1000,
      },
    );
    if ("operationId" in result && !priorJob)
      await ctx.db.insert("recoveryJobs", {
        ...scope,
        requestKey,
        sellerId: args.sellerId,
        kind: "cost",
        sourceId: args.sourceChargeId,
        paymentIntentId: args.paymentIntentId,
        observedAt: Date.now(),
        sourceType: args.sourceType,
        ...(args.invoiceRecoveryGroupKey
          ? { groupKey: args.invoiceRecoveryGroupKey }
          : {}),
        ...(existing?.recoveryVersion !== 1 && existing
          ? { legacyObservedAt: existing.observedAt }
          : {}),
        operationId: result.operationId,
        version: result.version,
      });
    if ("operationId" in result) {
      const blocked = await ctx.db
        .query("recoveryJobs")
        .withIndex("by_request", (q) =>
          q.eq("requestKey", `example:blocked-cost:${args.paymentIntentId}`),
        )
        .unique();
      if (blocked) await ctx.db.delete("recoveryJobs", blocked._id);
    }
    if (
      priorJob &&
      "operationId" in result &&
      !["completed", "conflict", "rejected"].includes(result.status)
    )
      return stripe.costRecovery.resumeProcessingCostReconciliation(ctx, {
        ...scope,
        operationId: result.operationId,
        version: result.version,
      });
    return result;
  },
});
export const importOpening = internalMutation({
  args: {
    ...operationRefFields,
    claimKey: v.string(),
    expectedRevision: v.number(),
    sourceChargeId: v.string(),
    sourceGross: v.number(),
    sourceProcessingFee: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const job = await readJob(ctx, args);
    if (
      job.kind !== "cost" ||
      job.sourceId !== args.sourceChargeId ||
      costClaimKey(job.paymentIntentId!) !== args.claimKey
    )
      throw new Error("Original opening source changed.");
    const existing = await ctx.db
      .query("sellerCosts")
      .withIndex("by_charge", (q) => q.eq("sourceChargeId", job.sourceId))
      .first();
    if (!existing || existing.recoveryVersion === 1) return null;
    if (
      existing.sellerId !== job.sellerId ||
      existing.paymentIntentId !== job.paymentIntentId ||
      existing.currency !== job.currency ||
      existing.observedAt !== job.legacyObservedAt
    )
      throw new Error("Original opening observation changed.");
    await ctx.runMutation(
      internal.sellerCosts.migration.mutations.adoptLegacy,
      {
        costId: existing._id,
        sourceGross: args.sourceGross,
        sourceProcessingFee: args.sourceProcessingFee,
        expectedObservedAt: existing.observedAt,
      },
    );
    const claim = await stripe.costRecovery.getClaim(ctx, {
      claimKey: args.claimKey,
    });
    if (!claim?.openingCollection)
      throw new Error("Original opening collection is unavailable.");
    return claim.openingCollection;
  },
});
export const project = internalMutation({
  args: {
    ...operationRefFields,
    status: v.literal("completed"),
    result: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await readJob(ctx, args),
      result = args.result;
    if (
      job.kind !== "cost" ||
      result.claim.claimKey !== costClaimKey(job.paymentIntentId!) ||
      result.observation.sourceChargeId !== job.sourceId ||
      result.claim.accountId !== job.accountId ||
      result.claim.scopeKey !== job.scopeKey ||
      result.claim.currency !== job.currency
    )
      throw new Error("Completed recovery projection ownership changed.");
    const existing = await ctx.db
      .query("sellerCosts")
      .withIndex("by_charge", (q) => q.eq("sourceChargeId", job.sourceId))
      .first();
    if (
      existing &&
      (existing.sellerId !== job.sellerId ||
        existing.paymentIntentId !== job.paymentIntentId ||
        existing.currency !== job.currency)
    )
      throw new Error("Cost source ownership cannot change.");
    const fields = {
      sellerId: job.sellerId,
      sourceChargeId: job.sourceId,
      paymentIntentId: job.paymentIntentId!,
      currency: job.currency,
      sourceType: job.sourceType,
      amountDue: result.claim.amountDue,
      collectedAmount: result.claim.collectedAmount,
      invoicedAmount: result.claim.reservedAmount,
      reservedAmount: result.claim.reservedAmount,
      outstanding: result.claim.outstanding,
      open: result.claim.outstanding !== 0,
      processingLoss: result.deficit.processingLiability,
      disputeFees: result.deficit.disputeLiability,
      observedAt: job.observedAt,
      sourceGross: result.observation.gross,
      sourceProcessingFee: result.observation.originalProcessingFee,
      recoveryVersion: 1,
      ...(job.groupKey ? { invoiceRecoveryGroupKey: job.groupKey } : {}),
    };
    if (existing) await ctx.db.patch("sellerCosts", existing._id, fields);
    else await ctx.db.insert("sellerCosts", fields);
    return null;
  },
});
/** Internal event/sweep continuation; it never silently refreshes the saved revision. */
export const resume = internalMutation({
  args: operationRefFields,
  returns: v.any(),
  handler: async (ctx, args) => {
    const job = await readJob(ctx, args);
    if (job.kind !== "cost")
      throw new Error("Recovery operation kind does not match.");
    return stripe.costRecovery.resumeProcessingCostReconciliation(ctx, args);
  },
});
