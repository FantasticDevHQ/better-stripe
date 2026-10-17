import { transferReferenceDoc } from "./transferReferenceSchema.js";
import { transferReaderState } from "./transferBatches.js";
import { transferObservationDoc, transferBatchDoc } from "./transferSchema.js";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import { v } from "convex/values";
import { query } from "../_generated/server.js";
import { assertOwner, assertSelector } from "../financialOwnership/helpers.js";
import { ownerFields } from "../financialOwnership/schema.js";
import schema from "../schema.js";
import {
  bucketScope,
  observationGeneration,
  ownerScope,
} from "./generations.js";
import { legDoc, sourceDoc } from "./schema.js";

const transferReadFields = {
  coverage: v.literal("unknown"),
  producerGeneration: v.union(v.number(), v.null()),
  hasDeferredWork: v.boolean(),
};

export const source = query({
  args: { allocationId: v.id("settlementAllocations") },
  returns: v.object({
    coverage: v.literal("unknown"),
    observation: v.union(v.null(), sourceDoc),
  }),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("financialSourceObservations")
      .withIndex("by_allocation_id", (q) =>
        q.eq("allocationId", args.allocationId),
      )
      .take(2);
    return {
      coverage: "unknown" as const,
      observation:
        rows.length === 1 &&
        Number.isSafeInteger(rows[0]!.generation) &&
        rows[0]!.generation >= 1
          ? rows[0]!
          : null,
    };
  },
});
const result = v.object({
  ...paginationResultValidator(legDoc).fields,
  coverage: v.literal("unknown"),
  generation: v.union(v.number(), v.null()),
});
function assertPageSize(numItems: number) {
  if (!Number.isInteger(numItems) || numItems < 1 || numItems > 100)
    throw new Error("Observation page size must be between 1 and 100");
}
/** Trusted host boundary; exact keys do not authorize end-user access. */
export const bucket = query({
  args: { bucketKey: v.string(), paginationOpts: paginationOptsValidator },
  returns: result,
  handler: async (ctx, args) => {
    assertSelector(args.bucketKey);
    assertPageSize(args.paginationOpts.numItems);
    const page = await paginator(ctx.db, schema)
      .query("financialSourceLegs")
      .withIndex("by_bucket_key", (q) => q.eq("bucketKey", args.bucketKey))
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        maximumRowsRead: 200,
        maximumBytesRead: 1_000_000,
      });
    return {
      ...page,
      coverage: "unknown" as const,
      generation: await observationGeneration(ctx, bucketScope(args.bucketKey)),
    };
  },
});
export const owner = query({
  args: { ...ownerFields, paginationOpts: paginationOptsValidator },
  returns: result,
  handler: async (ctx, args) => {
    assertOwner(args);
    assertPageSize(args.paginationOpts.numItems);
    const page = await paginator(ctx.db, schema)
      .query("financialSourceLegs")
      .withIndex("by_owner", (q) =>
        q.eq("userId", args.userId).eq("orgId", args.orgId),
      )
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        maximumRowsRead: 200,
        maximumBytesRead: 1_000_000,
      });
    return {
      ...page,
      coverage: "unknown" as const,
      generation: await observationGeneration(
        ctx,
        ownerScope(args.userId, args.orgId),
      ),
    };
  },
});

export const transfer = query({
  args: { transferId: v.id("transfers") },
  returns: v.object({
    ...transferReadFields,
    observation: v.union(transferObservationDoc, v.null()),
  }),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("financialTransferObservations")
      .withIndex("by_transfer_id", (q) => q.eq("transferId", args.transferId))
      .take(2);
    const row = rows.length === 1 ? rows[0] : null;
    return {
      ...(await transferReaderState(ctx)),
      observation:
        row && Number.isSafeInteger(row.generation) && row.generation >= 1
          ? row
          : null,
    };
  },
});
export const transferBatches = query({
  args: { operationId: v.string(), paginationOpts: paginationOptsValidator },
  returns: v.object({
    ...paginationResultValidator(transferBatchDoc).fields,
    coverage: v.literal("unknown"),
    hasDeferredWork: v.boolean(),
    producerGeneration: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, args) => {
    assertSelector(args.operationId);
    assertPageSize(args.paginationOpts.numItems);
    const page = await paginator(ctx.db, schema)
      .query("financialTransferBatches")
      .withIndex("by_operation_id", (q) =>
        q.eq("operationId", args.operationId),
      )
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        maximumRowsRead: 200,
        maximumBytesRead: 1_000_000,
      });
    return { ...page, ...(await transferReaderState(ctx)) };
  },
});
const transferPageResult = v.object({
  ...paginationResultValidator(transferObservationDoc).fields,
  ...transferReadFields,
  generation: v.union(v.number(), v.null()),
});
export const transferBucket = query({
  args: { bucketKey: v.string(), paginationOpts: paginationOptsValidator },
  returns: transferPageResult,
  handler: async (ctx, args) => {
    assertSelector(args.bucketKey);
    assertPageSize(args.paginationOpts.numItems);
    const page = await paginator(ctx.db, schema)
      .query("financialTransferObservations")
      .withIndex("by_bucket_key", (q) => q.eq("bucketKey", args.bucketKey))
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        maximumRowsRead: 200,
        maximumBytesRead: 1_000_000,
      });
    return {
      ...page,
      ...(await transferReaderState(ctx)),
      generation: await observationGeneration(ctx, bucketScope(args.bucketKey)),
    };
  },
});
export const transferOwner = query({
  args: { ...ownerFields, paginationOpts: paginationOptsValidator },
  returns: transferPageResult,
  handler: async (ctx, args) => {
    assertOwner(args);
    assertPageSize(args.paginationOpts.numItems);
    const page = await paginator(ctx.db, schema)
      .query("financialTransferObservations")
      .withIndex("by_owner", (q) =>
        q.eq("userId", args.userId).eq("orgId", args.orgId),
      )
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        maximumRowsRead: 200,
        maximumBytesRead: 1_000_000,
      });
    return {
      ...page,
      ...(await transferReaderState(ctx)),
      generation: await observationGeneration(
        ctx,
        ownerScope(args.userId, args.orgId),
      ),
    };
  },
});

export const transferReferences = query({
  args: {
    batchId: v.id("financialTransferBatches"),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    ...paginationResultValidator(transferReferenceDoc).fields,
    ...transferReadFields,
  }),
  handler: async (ctx, args) => {
    assertPageSize(args.paginationOpts.numItems);
    const page = await paginator(ctx.db, schema)
      .query("financialTransferBatchReferences")
      .withIndex("by_batch_position", (q) => q.eq("batchId", args.batchId))
      .order("asc")
      .paginate({
        ...args.paginationOpts,
        maximumRowsRead: 200,
        maximumBytesRead: 1_000_000,
      });
    return { ...page, ...(await transferReaderState(ctx)) };
  },
});

export const transferBatch = query({
  args: { batchId: v.id("financialTransferBatches") },
  returns: v.object({
    ...transferReadFields,
    batch: v.union(transferBatchDoc, v.null()),
  }),
  handler: async (ctx, args) => ({
    ...(await transferReaderState(ctx)),
    batch: await ctx.db.get("financialTransferBatches", args.batchId),
  }),
});
