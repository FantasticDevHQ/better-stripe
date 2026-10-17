import { anyApi } from "convex/server";
import { v } from "convex/values";
import { internalMutation } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { stripe } from "../../../stripe/helpers";
import { costScope } from "../../recovery";
import { readJob, jobReference } from "../../workflow/helpers";
import { operationRefFields } from "../../workflow/validators";
export const start = internalMutation({
  args: {
    sellerId: v.id("users"),
    invoiceId: v.string(),
    currency: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const seller = await ctx.db.get("users", args.sellerId);
    if (seller?.role !== "seller" || !seller.stripeAccountId)
      throw new Error("Original invoice owner is unavailable.");
    const scope = costScope(seller._id, seller.stripeAccountId, args.currency),
      groupKey = `example:cost-invoice:${args.invoiceId}`;
    let group = await stripe.costRecovery.getGroup(ctx, { groupKey });
    if (!group || group.status === "open") {
      const prepared = await ctx.runMutation(
        internal.sellerCosts.recoveryInvoices.mutations.prepare,
        args,
      );
      if (prepared === null) return { status: "scope_busy" };
      if (!prepared) {
        await ctx.scheduler.runAfter(
          0,
          anyApi.sellerCosts.recoveryInvoices.workflow.mutations.start,
          args,
        );
        return { status: "preparing" };
      }
      group = await stripe.costRecovery.getGroup(ctx, { groupKey });
    }
    if (
      !group ||
      group.accountId !== scope.accountId ||
      group.scopeKey !== scope.scopeKey ||
      group.currency !== scope.currency ||
      group.sourceKind !== "invoice" ||
      group.sourceId !== args.invoiceId
    )
      throw new Error("Original invoice recovery ownership changed.");
    const requestKey = `example:invoice-workflow:v1:${args.invoiceId}`;
    const job = await ctx.db
      .query("recoveryJobs")
      .withIndex("by_request", (q) => q.eq("requestKey", requestKey))
      .unique();
    if (job?.operationId) {
      const ref = { ...jobReference(job), groupKey };
      const state = await stripe.costRecovery.getGroupOperation(ctx, ref);
      return !["completed", "canceled"].includes(state.status)
        ? stripe.costRecovery.resumeGroup(ctx, ref)
        : state;
    }
    if (
      ["collected", "released", "collecting", "releasing"].includes(
        group.status,
      )
    ) {
      if (!job)
        await ctx.db.insert("recoveryJobs", {
          ...scope,
          requestKey,
          sellerId: seller._id,
          kind: "invoice",
          sourceId: args.invoiceId,
          groupKey,
          observedAt: Date.now(),
          blockedReason: "legacy_inflight_unknown",
        });
      return {
        status: ["collected", "released"].includes(group.status)
          ? "legacy_terminal"
          : "legacy_inflight",
      };
    }
    const result = await stripe.costRecovery.startGroup(ctx, {
      ...scope,
      groupKey,
      requestKey,
      provider: anyApi.sellerCosts.recoveryInvoices.workflow.actions.execute,
      completion:
        anyApi.sellerCosts.recoveryInvoices.workflow.mutations.complete,
      providerApiVersion: "2026-09-30.endive",
      definitionVersion: 1,
      releaseUncollectible: false,
      maxAttempts: 3,
      retryDelayMs: 1000,
    });
    if ("operationId" in result && !job)
      await ctx.db.insert("recoveryJobs", {
        ...scope,
        requestKey,
        sellerId: seller._id,
        kind: "invoice",
        sourceId: args.invoiceId,
        groupKey,
        observedAt: Date.now(),
        operationId: result.operationId,
        version: result.version,
      });
    return result;
  },
});
export const complete = internalMutation({
  args: {
    ...operationRefFields,
    groupKey: v.string(),
    sourceKind: v.union(v.literal("invoice"), v.literal("settlement")),
    sourceId: v.string(),
    status: v.string(),
    cancelRequested: v.boolean(),
    outcome: v.optional(v.union(v.literal("collect"), v.literal("release"))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await readJob(ctx, args);
    if (
      job.kind !== "invoice" ||
      job.sourceId !== args.sourceId ||
      job.groupKey !== args.groupKey ||
      args.sourceKind !== "invoice" ||
      args.status !== "completed"
    )
      throw new Error("Completed invoice recovery ownership changed.");
    const group = await stripe.costRecovery.getGroup(ctx, {
      groupKey: args.groupKey,
    });
    if (
      !group ||
      group.accountId !== job.accountId ||
      group.scopeKey !== job.scopeKey ||
      group.currency !== job.currency ||
      group.sourceId !== job.sourceId ||
      group.sourceKind !== "invoice" ||
      group.status !== (args.outcome === "collect" ? "collected" : "released")
    )
      throw new Error("Invoice recovery completion is not verified.");
    return null;
  },
});
/** The action verifies provider item/outcome first; this mutation binds that proof to immutable local ownership. */
export const verifyLegacyTerminal = internalMutation({
  args: {
    sellerId: v.id("users"),
    invoiceId: v.string(),
    currency: v.string(),
    outcome: v.union(v.literal("collected"), v.literal("released")),
    invoiceItemId: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const seller = await ctx.db.get("users", args.sellerId);
    if (seller?.role !== "seller" || !seller.stripeAccountId)
      throw new Error("Original invoice owner is unavailable.");
    const scope = costScope(
        args.sellerId,
        seller.stripeAccountId,
        args.currency,
      ),
      groupKey = `example:cost-invoice:${args.invoiceId}`;
    const group = await stripe.costRecovery.getGroup(ctx, { groupKey });
    if (
      !group ||
      group.sourceKind !== "invoice" ||
      group.sourceId !== args.invoiceId ||
      group.accountId !== scope.accountId ||
      group.scopeKey !== scope.scopeKey ||
      group.currency !== scope.currency ||
      group.status !== args.outcome ||
      (group.invoiceItemId ?? null) !== args.invoiceItemId ||
      (args.outcome === "collected" && !args.invoiceItemId)
    )
      throw new Error("Legacy invoice receipt bindings changed.");
    const requestKey = `example:invoice-workflow:v1:${args.invoiceId}`;
    const job = await ctx.db
      .query("recoveryJobs")
      .withIndex("by_request", (q) => q.eq("requestKey", requestKey))
      .unique();
    if (job?.operationId) return null;
    if (job)
      await ctx.db.patch("recoveryJobs", job._id, {
        legacyVerified: true,
        blockedReason: undefined,
      });
    else
      await ctx.db.insert("recoveryJobs", {
        ...scope,
        requestKey,
        sellerId: args.sellerId,
        kind: "invoice",
        sourceId: args.invoiceId,
        groupKey,
        observedAt: Date.now(),
        legacyVerified: true,
      });
    return null;
  },
});

/** Only an action with a complete read-only provider receipt may invoke this DB-only compatibility batch. */
export const finishLegacy = internalMutation({
  args: {
    sellerId: v.id("users"),
    invoiceId: v.string(),
    currency: v.string(),
    outcome: v.union(v.literal("collect"), v.literal("release")),
    invoiceItemId: v.string(),
    amount: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const seller = await ctx.db.get("users", args.sellerId);
    if (seller?.role !== "seller" || !seller.stripeAccountId)
      throw new Error("Original invoice owner is unavailable.");
    const scope = costScope(
        args.sellerId,
        seller.stripeAccountId,
        args.currency,
      ),
      groupKey = `example:cost-invoice:${args.invoiceId}`;
    const group = await stripe.costRecovery.getGroup(ctx, { groupKey });
    const terminal = args.outcome === "collect" ? "collected" : "released";
    const partial = args.outcome === "collect" ? "collecting" : "releasing";
    if (
      !group ||
      group.accountId !== scope.accountId ||
      group.scopeKey !== scope.scopeKey ||
      group.currency !== scope.currency ||
      group.sourceKind !== "invoice" ||
      group.sourceId !== args.invoiceId ||
      group.invoiceItemId !== args.invoiceItemId ||
      !args.invoiceItemId ||
      group.amount !== args.amount ||
      ![partial, terminal].includes(group.status)
    )
      throw new Error("Legacy invoice receipt bindings changed.");
    if (group.status !== terminal) {
      const finished = await stripe.costRecovery.finish(ctx, {
        groupKey,
        outcome: args.outcome,
      });
      if (!finished.isDone) {
        await ctx.scheduler.runAfter(
          0,
          internal.sellerCosts.recoveryInvoices.actions.reconcile,
          { sellerId: args.sellerId, invoiceId: args.invoiceId },
        );
        return null;
      }
    }
    await ctx.runMutation(
      anyApi.sellerCosts.recoveryInvoices.workflow.mutations
        .verifyLegacyTerminal,
      {
        sellerId: args.sellerId,
        invoiceId: args.invoiceId,
        currency: args.currency,
        outcome: terminal,
        invoiceItemId: args.invoiceItemId,
      },
    );
    return null;
  },
});
