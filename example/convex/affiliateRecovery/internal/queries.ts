import { v } from "convex/values";

import { internalQuery } from "../../_generated/server";

import { viewer } from "../helpers";

export const requireOperator = internalQuery({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.userId);
    if (user?.role !== "admin")
      throw new Error("An operator persona is required.");
    return null;
  },
});
