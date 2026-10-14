import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { components } from "./_generated/api";
/** One-time migration of the example's old claims into the package ledger. */
export const run = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const rows = await ctx.db.query("subscriptionCommissions").take(100);
    for (const row of rows) {
      await ctx.runMutation(
        components.betterStripe.settlement.mutations.claimCommissionInvoice,
        {
          subscriptionId: row.stripeSubscriptionId,
          term: row.affiliateCommissionTerm,
          firstPaidInvoiceId: row.firstInvoiceId,
          invoiceId: row.firstInvoiceId,
          affiliateAccountId: row.affiliateAccountId,
        },
      );
      await ctx.db.delete("subscriptionCommissions", row._id);
    }
    return rows.length;
  },
});
