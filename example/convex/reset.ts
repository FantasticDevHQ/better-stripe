import { internal } from './_generated/api';
import { internalAction, internalMutation } from './_generated/server';
import { stripe } from './stripe';

/**
 * Clear all app tables (users, courses, courseAccess, webhookLog).
 */
export const clearAppDb = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tables = ['users', 'courses', 'courseAccess', 'webhookLog'] as const;
    let totalCleared = 0;

    for (const tableName of tables) {
      const docs = await ctx.db.query(tableName).collect();
      for (const doc of docs) {
        await ctx.db.delete(doc._id);
      }
      if (docs.length > 0) {
        console.log(`[reset] Cleared ${docs.length} rows from ${tableName}`);
        totalCleared += docs.length;
      }
    }

    console.log(`[reset] App DB cleared: ${totalCleared} total rows`);
    return { cleared: totalCleared };
  },
});

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
 * Usage: npx convex run reset:run
 */
export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(internal.reset.clearAppDb, {});
    await ctx.runAction(internal.reset.clearStripeDb, {});
    console.log('[reset] All data cleared. Run `npm run setup` to re-seed.');
  },
});
