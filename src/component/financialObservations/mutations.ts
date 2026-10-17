import { continueTransferBatch } from "./transferContinuation.js";
import { transferReaderState } from "./transferBatches.js";
import { transferBatchDoc } from "./transferSchema.js";
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

/** Trusted host continuation; caller selects identity and generation, never cursor state. */
export const resumeTransferBatch = mutation({
  args: {
    batchId: v.id("financialTransferBatches"),
    expectedGeneration: v.number(),
  },
  returns: v.object({
    coverage: v.literal("unknown"),
    producerGeneration: v.union(v.number(), v.null()),
    hasDeferredWork: v.boolean(),
    batch: v.union(transferBatchDoc, v.null()),
  }),
  handler: async (ctx, args) => {
    if (
      !Number.isSafeInteger(args.expectedGeneration) ||
      args.expectedGeneration < 1
    )
      throw new Error("Invalid observation generation");
    const batch = await ctx.db.get("financialTransferBatches", args.batchId);
    if (batch) await continueTransferBatch(ctx, batch, args.expectedGeneration);
    return {
      ...(await transferReaderState(ctx)),
      batch: batch
        ? await ctx.db.get("financialTransferBatches", batch._id)
        : null,
    };
  },
});
