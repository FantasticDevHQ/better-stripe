import { v } from "convex/values";

import { action } from "../../_generated/server";

import { api, internal } from "../../_generated/api";

import { stripe } from "../../stripe/helpers";

import { costScope } from "../recovery";
import { type StoreInvoiceEstimate } from "./helpers";

export const estimate = action({
  args: { sellerId: v.id("users") },
  returns: v.object({
    currency: v.string(),
    total: v.number(),
    nextBillingAt: v.number(),
    lines: v.array(
      v.object({
        id: v.string(),
        description: v.string(),
        amount: v.number(),
        sourceType: v.optional(
          v.union(v.literal("refund"), v.literal("dispute")),
        ),
      }),
    ),
  }),
  handler: async (ctx, args): Promise<StoreInvoiceEstimate> => {
    const seller = await ctx.runQuery(
      internal.storePlans.billing.internal.queries.getSeller,
      args,
    );
    if (!seller.stripeAccountId || !seller.storePlan)
      throw new Error("Choose a store plan before estimating an invoice.");
    await ctx.runAction(
      internal.sellerCosts.recoveryInvoices.actions.migrateLegacy,
      args,
    );
    const preview = await stripe.getUpcomingInvoicePreview(ctx, {
      customerAccount: seller.stripeAccountId,
      stripeSubscriptionId: seller.storePlan.stripeSubscriptionId,
    });
    const costs = await ctx.runQuery(
      api.sellerCosts.billing.public.queries.list,
      args,
    );
    const adjustments: StoreInvoiceEstimate["lines"] = costs
      .filter(
        (cost) => cost.currency === preview.currency && cost.outstanding !== 0,
      )
      .map((cost) => {
        const sourceType =
          cost.sourceType ??
          (cost.disputeFees > 0 ? ("dispute" as const) : ("refund" as const));
        return {
          id: cost._id,
          description: `${sourceType === "refund" ? "Refund" : "Dispute"} cost${cost.outstanding < 0 ? " credit" : ""} · ${cost.paymentIntentId}`,
          amount: cost.outstanding,
          sourceType,
        };
      });
    const balance = await stripe.costRecovery.balance(
      ctx,
      costScope(args.sellerId, seller.stripeAccountId, preview.currency),
    );
    const remainder =
      balance.outstanding -
      adjustments.reduce((sum, line) => sum + line.amount, 0);
    if (remainder !== 0)
      adjustments.push({
        id: "additional-recovery",
        description: "Additional recovery adjustments",
        amount: remainder,
      });
    return {
      currency: preview.currency,
      total: preview.total + balance.outstanding,
      nextBillingAt: preview.nextBillingAt,
      lines: [
        ...preview.lines.map((line) => ({
          id: line.id,
          description: line.description ?? "Store subscription",
          amount: line.amount,
        })),
        ...adjustments,
      ],
    };
  },
});
