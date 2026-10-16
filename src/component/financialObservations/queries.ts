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
