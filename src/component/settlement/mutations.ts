import { v } from "convex/values";
import { mutation } from "../_generated/server.js";
import { allocationFields, commissionFields, termValidator } from "./schema.js";
const doc = v.object({
  ...allocationFields,
  _id: v.id("settlementAllocations"),
  _creationTime: v.number(),
});
export const reserveSettlementAllocation = mutation({
  args: allocationFields,
  returns: doc,
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("settlementAllocations")
      .withIndex("by_source_charge", (q) =>
        q.eq("sourceChargeId", args.sourceChargeId),
      )
      .first();
    if (existing) {
      if (
        existing.currency !== args.currency ||
        existing.paymentIntentId !== args.paymentIntentId ||
        existing.sourceInvoiceId !== args.sourceInvoiceId
      )
        throw new Error("Settlement source identity cannot change.");
      return existing;
    }
    const adjustment = args.adjustmentAmount ?? 0;
    const amounts = [
      args.gross,
      args.processingFee,
      args.platformNet,
      ...args.transfers.map((t) => t.amount),
    ];
    const keys = args.transfers.map(
      (t) => `${t.destinationAccountId}:${t.role}`,
    );
    if (
      !Number.isSafeInteger(adjustment) ||
      args.processingFee + args.platformNet + adjustment < 0 ||
      amounts.some((n) => !Number.isSafeInteger(n) || n < 0) ||
      args.gross <= 0 ||
      !args.currency ||
      !args.sourceChargeId ||
      args.transfers.some((t) => !t.destinationAccountId) ||
      new Set(keys).size !== keys.length ||
      args.gross !==
        args.processingFee +
          args.platformNet +
          adjustment +
          args.transfers.reduce((sum, t) => sum + t.amount, 0)
    )
      throw new Error(
        "Settlement allocation must reconcile in integer currency units with unique recipient legs.",
      );
    const id = await ctx.db.insert("settlementAllocations", args);
    return (await ctx.db.get("settlementAllocations", id))!;
  },
});
export const claimCommissionInvoice = mutation({
  args: { ...commissionFields, invoiceId: v.string() },
  returns: v.object({
    eligible: v.boolean(),
    term: termValidator,
    firstPaidInvoiceId: v.string(),
    claimKey: v.string(),
    replay: v.boolean(),
  }),
  handler: async (ctx, args) => {
    let stored = await ctx.db
      .query("commissionTerms")
      .withIndex("by_subscription", (q) =>
        q.eq("subscriptionId", args.subscriptionId),
      )
      .first();
    if (stored && stored.affiliateAccountId !== args.affiliateAccountId)
      throw new Error("Subscription affiliate identity cannot change.");
    if (!stored) {
      const fields = {
        subscriptionId: args.subscriptionId,
        term: args.term,
        affiliateAccountId: args.affiliateAccountId,
        firstPaidInvoiceId: args.firstPaidInvoiceId,
      };
      const id = await ctx.db.insert("commissionTerms", fields);
      stored = (await ctx.db.get("commissionTerms", id))!;
    }
    const existing = await ctx.db
      .query("commissionDecisions")
      .withIndex("by_subscription_invoice", (q) =>
        q
          .eq("subscriptionId", args.subscriptionId)
          .eq("invoiceId", args.invoiceId),
      )
      .first();
    const claimKey =
      existing?.claimKey ??
      `commission:${args.subscriptionId}:${args.invoiceId}`;
    const eligible =
      existing?.eligible ??
      (!!stored.affiliateAccountId &&
        (stored.term === "forever" ||
          args.invoiceId === stored.firstPaidInvoiceId));
    if (!existing)
      await ctx.db.insert("commissionDecisions", {
        subscriptionId: args.subscriptionId,
        invoiceId: args.invoiceId,
        eligible,
        claimKey,
      });
    return {
      eligible,
      term: stored.term,
      firstPaidInvoiceId: stored.firstPaidInvoiceId,
      claimKey,
      replay: !!existing,
    };
  },
});
