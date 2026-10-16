import { v } from "convex/values";
import { mutation } from "../_generated/server.js";
import { sourceDoc } from "./schema.js";
import { continueSettlementObservation } from "./continuation.js";
/** Trusted host mutation. Host must authorize access and explicitly drain bounded steps. */
export const resume = mutation({
  args: {
    allocationId: v.id("settlementAllocations"),
    expectedGeneration: v.number(),
  },
  returns: v.object({
    coverage: v.literal("unknown"),
    observation: v.union(sourceDoc, v.null()),
  }),
  handler: async (ctx, args) => {
    if (
      !Number.isSafeInteger(args.expectedGeneration) ||
      args.expectedGeneration < 1
    )
      throw new Error("Invalid observation generation");
    const markers = await ctx.db
      .query("financialSourceObservations")
      .withIndex("by_allocation_id", (q) =>
        q.eq("allocationId", args.allocationId),
      )
      .take(2);
    const marker = markers.length === 1 ? markers[0]! : null;
    if (marker)
      await continueSettlementObservation(ctx, marker, args.expectedGeneration);
    const current = marker
      ? await ctx.db.get("financialSourceObservations", marker._id)
      : null;
    return {
      coverage: "unknown" as const,
      observation:
        current &&
        Number.isSafeInteger(current.generation) &&
        current.generation >= 1
          ? current
          : null,
    };
  },
});
