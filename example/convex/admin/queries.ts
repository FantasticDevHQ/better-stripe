import { query } from "../_generated/server";

export const getSeedStatus = query({
  args: {},
  handler: async (ctx) => {
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- Counts the small, fixed set of demo personas.
    const users = await ctx.db.query("users").collect();
    return { userCount: users.length };
  },
});
