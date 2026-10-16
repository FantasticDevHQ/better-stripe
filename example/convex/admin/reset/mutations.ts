import { internalMutation } from "../../_generated/server";

/**
 * Clear all app tables (users).
 */
export const clearAppDb = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tables = [
      "users",
      "storeSales",
      "subscriptionCommissions",
      "sellerAffiliateRates",
      "affiliateDefaults",
      "sellerCosts",
      "storeCostBills",
      "storeBalanceFunding",
      "storePlanCatalog",
      "sandboxFixtureJobs",
      "sandboxFixtureResources",
    ] as const;
    let totalCleared = 0;

    for (const tableName of tables) {
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- Internal reset mutation over the seeded demo personas.
      const docs = await ctx.db.query(tableName).collect();
      for (const doc of docs) {
        await ctx.db.delete(tableName, doc._id);
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
