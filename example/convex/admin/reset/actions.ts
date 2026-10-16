import { internal } from "../../_generated/api";

import { internalAction } from "../../_generated/server";

import { stripe } from "../../stripe/helpers";

/**
 * Clear all better-stripe component tables (accounts, products, prices, etc).
 */
export const clearStripeDb = internalAction({
  args: {},
  handler: async (ctx) => {
    const result = await stripe.clearAll(ctx);
    console.log(
      `[reset] BetterStripe DB cleared: ${result.cleared} rows across ${result.tables.length} tables`,
    );
    return result;
  },
});

/**
 * Full reset: clear app DB + better-stripe component DB.
 *
 * Usage: npx convex run admin/reset/actions:run
 */
export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    // Preserve host owner bindings when the component refuses an unsafe reset.
    await ctx.runAction(internal.admin.reset.actions.clearStripeDb, {});
    await ctx.runMutation(internal.admin.reset.mutations.clearAppDb, {});
    console.log("[reset] All data cleared. Run `npm run setup` to re-seed.");
  },
});
