import { anyApi } from "convex/server";
import { v } from "convex/values";

import { internalAction } from "../../_generated/server";

import { internal } from "../../_generated/api";

import { stripe } from "../../stripe/helpers";

import { costScope } from "../recovery";

import { getStripeClient } from "../../stripe/client";

/** Called for every plan invoice outcome, not only its creation webhook. */
export const reconcile = internalAction({
  args: { sellerId: v.id("users"), invoiceId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const seller = await ctx.runQuery(
      internal.storePlans.billing.internal.queries.getSeller,
      {
        sellerId: args.sellerId,
      },
    );
    if (!seller.stripeAccountId)
      throw new Error("Seller account is unavailable.");
    const groupKey = `example:cost-invoice:${args.invoiceId}`;
    const group = await stripe.costRecovery.getGroup(ctx, { groupKey });
    if (!group) return null;
    const opts = {
      ...costScope(args.sellerId, seller.stripeAccountId, group.currency),
      groupKey,
    };
    const operation = await ctx.runMutation(
      anyApi.sellerCosts.recoveryInvoices.workflow.mutations.start,
      { ...args, currency: group.currency },
    );
    if (["legacy_terminal", "legacy_inflight"].includes(operation.status)) {
      const receipt = await stripe.costRecovery.verifyInvoiceReceipt(ctx, opts);
      // Missing, ambiguous or incomplete evidence leaves the persisted direction and reservations held.
      if (receipt.status !== "ready") return null;
      await ctx.runMutation(
        anyApi.sellerCosts.recoveryInvoices.workflow.mutations.finishLegacy,
        {
          ...args,
          currency: group.currency,
          outcome: receipt.outcome,
          invoiceItemId: receipt.invoiceItemId,
          amount: receipt.group.amount,
        },
      );
    }
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
        internal.sellerCosts.migration.queries.legacyBatch,
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
        await ctx.runMutation(
          internal.sellerCosts.migration.mutations.adoptLegacy,
          {
            costId: row._id,
            sourceGross: source.gross,
            sourceProcessingFee: source.processingFee,
            expectedObservedAt: row.observedAt,
          },
        );
      }
    }
  },
});

export const attach = internalAction({
  args: { sellerId: v.id("users"), invoiceId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const invoice = await getStripeClient().invoices.retrieve(args.invoiceId);
    const seller = await ctx.runQuery(
      internal.storePlans.billing.internal.queries.getSeller,
      {
        sellerId: args.sellerId,
      },
    );
    if (
      !seller.stripeAccountId ||
      invoice.customer_account !== seller.stripeAccountId
    )
      throw new Error("Cost invoice belongs to another Stripe account.");
    await ctx.runAction(
      internal.sellerCosts.recoveryInvoices.actions.migrateLegacy,
      {
        sellerId: args.sellerId,
      },
    );
    const operation = await ctx.runMutation(
      anyApi.sellerCosts.recoveryInvoices.workflow.mutations.start,
      { ...args, currency: invoice.currency },
    );
    if (["legacy_terminal", "legacy_inflight"].includes(operation.status))
      await ctx.runAction(
        internal.sellerCosts.recoveryInvoices.actions.reconcile,
        args,
      );
    return null;
  },
});
