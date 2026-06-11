import { v } from "convex/values";

import { query } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("users").collect();
  },
});

export const getByRole = query({
  args: {
    role: v.union(
      v.literal("customer"),
      v.literal("seller"),
      v.literal("admin"),
    ),
  },
  handler: async (ctx, args) => {
    // Mock example app with a tiny seeded users table (3 rows).
    /* eslint-disable @convex-dev/no-filter-in-query */
    return await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("role"), args.role))
      .first();
    /* eslint-enable @convex-dev/no-filter-in-query */
  },
});
