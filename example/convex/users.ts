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
      v.literal("visitor"),
      v.literal("buyer"),
      v.literal("affiliate"),
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", args.role))
      .first();
  },
});
