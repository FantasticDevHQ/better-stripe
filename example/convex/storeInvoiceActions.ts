import { v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { getStripeClient } from "./lib/stripeClient";

export interface StoreInvoiceEstimate {
  currency: string;
  total: number;
  nextBillingAt: number;
  lines: {
    id: string;
    description: string;
    amount: number;
    sourceType?: "refund" | "dispute";
  }[];
}
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
      internal.storePlanBilling.getSeller,
      args,
    );
    if (!seller.stripeAccountId || !seller.storePlan)
      throw new Error("Choose a store plan before estimating an invoice.");
    const preview = await getStripeClient().invoices.createPreview({
      customer_account: seller.stripeAccountId,
      subscription: seller.storePlan.stripeSubscriptionId,
    });
    if (preview.lines.has_more)
      throw new Error(
        "View this invoice's complete itemization in Stripe's billing portal.",
      );
    const costs = await ctx.runQuery(api.sellerCostBilling.list, args);
    const adjustments = costs
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
    return {
      currency: preview.currency,
      total:
        preview.total + adjustments.reduce((sum, line) => sum + line.amount, 0),
      nextBillingAt: seller.storePlan.paidThrough,
      lines: [
        ...preview.lines.data.map((line) => ({
          id: line.id,
          description: line.description ?? "Store subscription",
          amount: line.amount,
        })),
        ...adjustments,
      ],
    };
  },
});
