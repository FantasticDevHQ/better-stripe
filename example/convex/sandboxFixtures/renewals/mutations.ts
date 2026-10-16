/** Real Stripe sandbox renewal scenarios. Invoked by scripts/test-balance-renewals.ts. */
import { v } from "convex/values";

import { internalMutation } from "../../_generated/server";

export const seller = internalMutation({
  args: {
    runId: v.string(),
    scenario: v.union(v.literal("funded"), v.literal("insufficient")),
  },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    if (!/^[a-z0-9-]{1,60}$/.test(args.runId))
      throw new Error("Invalid renewal test ID.");
    const email = `renewal-${args.runId}-${args.scenario}@example.com`;
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (existing) {
      if (!existing.testFixture) throw new Error("Not a renewal test seller.");
      return existing._id;
    }
    return ctx.db.insert("users", {
      name: `Renewal QA ${args.scenario}`,
      email,
      role: "seller",
      testFixture: true,
    });
  },
});
