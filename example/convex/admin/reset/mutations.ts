import type { TableNames } from "../../_generated/dataModel";

import { internalMutation } from "../../_generated/server";

import schema from "../../schema";

/**
 * Clear every app table defined in `convex/schema.ts`.
 *
 * The table list is derived from the schema definition (the same approach as
 * the component's own `clearAllTables`), so a newly added table can never be
 * left behind holding rows that reference deleted users.
 */
export const clearAppDb = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tables = Object.keys(schema.tables) as TableNames[];
    let totalCleared = 0;

    for (const tableName of tables) {
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- Internal reset mutation: deliberately clears every row of the demo tables.
      const docs = await ctx.db.query(tableName).collect();
      for (const doc of docs) {
        // eslint-disable-next-line @convex-dev/explicit-table-ids -- The table name is a schema-derived union here, so the id cannot be narrowed per table.
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
