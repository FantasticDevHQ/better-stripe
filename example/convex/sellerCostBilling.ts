import { assertLegacyRecoveryWriter } from "./lib/sellerRecovery";
import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { sellerCostDoc, costBillDoc } from "./lib/sellerCostValidators";
export const record = internalMutation({
  args: {
    sellerId: v.id("users"),
    sourceChargeId: v.string(),
    paymentIntentId: v.string(),
    currency: v.string(),
    sourceType: v.optional(v.union(v.literal("refund"), v.literal("dispute"))),
    amountDue: v.number(),
    processingLoss: v.number(),
    disputeFees: v.number(),
    observedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertLegacyRecoveryWriter(ctx, args.sellerId);
    if (
      !Number.isSafeInteger(args.amountDue) ||
      [args.processingLoss, args.disputeFees].some(
        (n) => !Number.isSafeInteger(n) || n < 0,
      )
    )
      throw new Error("Invalid seller cost.");
    const existing = await ctx.db
      .query("sellerCosts")
      .withIndex("by_charge", (q) =>
        q.eq("sourceChargeId", args.sourceChargeId),
      )
      .first();
    if (existing && existing.observedAt > args.observedAt) return null;
    const collectedAmount = existing?.collectedAmount ?? 0;
    const invoicedAmount = existing?.invoicedAmount ?? 0;
    const outstanding = args.amountDue - collectedAmount - invoicedAmount;
    if (existing)
      await ctx.db.patch("sellerCosts", existing._id, {
        ...args,
        outstanding,
        open: outstanding !== 0,
      });
    else if (args.amountDue !== 0)
      await ctx.db.insert("sellerCosts", {
        ...args,
        collectedAmount,
        invoicedAmount,
        outstanding,
        open: true,
      });
    return null;
  },
});
export const list = query({
  args: { sellerId: v.id("users") },
  returns: v.array(sellerCostDoc),
  handler: async (ctx, args) => {
    if ((await ctx.db.get("users", args.sellerId))?.role !== "seller")
      throw new Error("Choose a seller to view costs.");
    return ctx.db
      .query("sellerCosts")
      .withIndex("by_seller", (q) => q.eq("sellerId", args.sellerId))
      .order("desc")
      .take(100);
  },
});
export const claimInvoice = internalMutation({
  args: {
    sellerId: v.id("users"),
    invoiceId: v.string(),
    currency: v.string(),
  },
  returns: v.union(costBillDoc, v.null()),
  handler: async (ctx, args) => {
    await assertLegacyRecoveryWriter(ctx, args.sellerId);
    const existing = await ctx.db
      .query("storeCostBills")
      .withIndex("by_invoice", (q) => q.eq("invoiceId", args.invoiceId))
      .first();
    if (existing) {
      if (existing.sellerId !== args.sellerId)
        throw new Error("Invoice belongs to another seller.");
      return existing;
    }
    const costs = (
      await ctx.db
        .query("sellerCosts")
        .withIndex("by_seller_open", (q) =>
          q.eq("sellerId", args.sellerId).eq("open", true),
        )
        .take(100)
    ).filter((cost) => cost.currency === args.currency);
    if (!costs.length) return null;
    const allocations = costs.map((cost) => ({
      costId: cost._id,
      amount: cost.outstanding,
    }));
    const amount = allocations.reduce((sum, item) => sum + item.amount, 0);
    for (const cost of costs)
      await ctx.db.patch("sellerCosts", cost._id, {
        invoicedAmount: cost.invoicedAmount + cost.outstanding,
        outstanding: 0,
        open: false,
      });
    const id = await ctx.db.insert("storeCostBills", {
      ...args,
      amount,
      allocations,
      status: "pending",
    });
    return (await ctx.db.get("storeCostBills", id))!;
  },
});
export const markAttached = internalMutation({
  args: {
    billId: v.id("storeCostBills"),
    stripeInvoiceItemId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("storeCostBills", args.billId, {
      status: "attached",
      stripeInvoiceItemId: args.stripeInvoiceItemId,
    });
    return null;
  },
});
export const getBill = internalQuery({
  args: { invoiceId: v.string() },
  returns: v.union(costBillDoc, v.null()),
  handler: (ctx, args) =>
    ctx.db
      .query("storeCostBills")
      .withIndex("by_invoice", (q) => q.eq("invoiceId", args.invoiceId))
      .first(),
});
