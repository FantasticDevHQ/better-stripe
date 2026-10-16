import { v } from "convex/values";

import { internalQuery } from "../../../_generated/server";

import { planValidator, plans } from "../helpers";

export const read = internalQuery({
  args: {},
  returns: v.array(planValidator),
  handler: plans,
});

export const authorize = internalQuery({
  args: { adminId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    if ((await ctx.db.get("users", args.adminId))?.role !== "admin")
      throw new Error("Only an admin can change store plan pricing.");
    return null;
  },
});
