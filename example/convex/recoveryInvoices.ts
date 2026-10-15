import { v } from "convex/values";
import { internalMutation, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { stripe } from "./stripe";
import { costScope } from "./lib/sellerRecovery";
import { getStripeClient } from "./lib/stripeClient";

export const prepare = internalMutation({
  args: {
    sellerId: v.id("users"),
    invoiceId: v.string(),
    currency: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const seller = await ctx.db.get("users", args.sellerId);
    if (seller?.role !== "seller" || !seller.stripeAccountId)
      throw new Error("Seller account is unavailable.");
    if (
      await ctx.db
        .query("sellerCosts")
        .withIndex("by_recovery_version", (q) =>
          q.eq("sellerId", seller._id).eq("recoveryVersion", undefined),
        )
        .first()
    )
      throw new Error("Migrate legacy recovery before preparing an invoice.");
    const scope = costScope(seller._id, seller.stripeAccountId, args.currency),
      groupKey = `example:cost-invoice:${args.invoiceId}`;
    const existing = await stripe.costRecovery.getGroup(ctx, { groupKey });
    if (
      existing &&
      (existing.accountId !== scope.accountId ||
        existing.scopeKey !== scope.scopeKey ||
        existing.currency !== scope.currency)
    )
      throw new Error("Recovery invoice scope changed.");
    if (existing && existing.status !== "open") return true;
    await stripe.costRecovery.reserve(ctx, {
      ...scope,
      groupKey,
      operationKey: `${groupKey}:batch:${existing?.pendingOperations ?? 0}`,
      sourceKind: "invoice",
      sourceId: args.invoiceId,
      maxDebit: Number.MAX_SAFE_INTEGER,
      maxCredit: Number.MAX_SAFE_INTEGER,
    });
    const ledger = await stripe.costRecovery.balance(ctx, scope);
    if (ledger.outstanding !== 0) return false;
    await stripe.costRecovery.seal(ctx, { groupKey });
    return true;
  },
});
/** Called for every plan invoice outcome, not only its creation webhook. */
export const reconcile = internalAction({
  args: { sellerId: v.id("users"), invoiceId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const seller = await ctx.runQuery(internal.storePlanBilling.getSeller, {
      sellerId: args.sellerId,
    });
    if (!seller.stripeAccountId)
      throw new Error("Seller account is unavailable.");
    const groupKey = `example:cost-invoice:${args.invoiceId}`;
    const group = await stripe.costRecovery.getGroup(ctx, { groupKey });
    if (!group) return null;
    const opts = {
      ...costScope(args.sellerId, seller.stripeAccountId, group.currency),
      groupKey,
    };
    let done: boolean;
    do {
      const receipt = await stripe.costRecovery.reconcileInvoice(ctx, opts);
      done =
        receipt.isDone ||
        !["paid", "void"].includes(receipt.invoiceStatus ?? "");
    } while (!done);
    return null;
  },
});
/** Verify original provider economics, then adopt only legacy rows with resolved boundaries. */
export const migrateLegacy = internalAction({
  args: { sellerId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    for (;;) {
      const rows = await ctx.runQuery(
        internal.recoveryMigration.legacyBatch,
        args,
      );
      if (!rows.length) return null;
      for (const row of rows) {
        const source = await stripe.getProcessingCostContext(ctx, {
          paymentIntentId: row.paymentIntentId,
        });
        if (
          source.status !== "ready" ||
          source.chargeId !== row.sourceChargeId ||
          source.currency !== row.currency
        )
          throw new Error("Legacy recovery source is not verified yet.");
        await ctx.runMutation(internal.recoveryMigration.adoptLegacy, {
          costId: row._id,
          sourceGross: source.gross,
          sourceProcessingFee: source.processingFee,
          expectedObservedAt: row.observedAt,
        });
      }
    }
  },
});
export const attach = internalAction({
  args: { sellerId: v.id("users"), invoiceId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const invoice = await getStripeClient().invoices.retrieve(args.invoiceId);
    const seller = await ctx.runQuery(internal.storePlanBilling.getSeller, {
      sellerId: args.sellerId,
    });
    if (
      !seller.stripeAccountId ||
      invoice.customer_account !== seller.stripeAccountId
    )
      throw new Error("Cost invoice belongs to another Stripe account.");
    await ctx.runAction(internal.recoveryInvoices.migrateLegacy, {
      sellerId: args.sellerId,
    });
    while (
      !(await ctx.runMutation(internal.recoveryInvoices.prepare, {
        ...args,
        currency: invoice.currency,
      }))
    ) {
      /* Bounded reservation batches. */
    }
    const opts = {
      ...costScope(args.sellerId, seller.stripeAccountId, invoice.currency),
      groupKey: `example:cost-invoice:${invoice.id}`,
    };
    if (invoice.status === "draft")
      await stripe.costRecovery.attachInvoice(ctx, opts);
    else await ctx.runAction(internal.recoveryInvoices.reconcile, args);
    return null;
  },
});
