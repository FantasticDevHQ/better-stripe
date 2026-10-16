import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import { v } from "convex/values";
import { query } from "../_generated/server.js";
import schema from "../schema.js";
import {
  assertOwner,
  assertSelector,
  ownerGeneration,
  registrationByKey,
} from "./helpers.js";
import { ownerFields, registrationDoc, registrationResult } from "./schema.js";

/** Trusted host reader; a bucket key is not end-user authorization. */
export const lookup = query({
  args: { bucketKey: v.string() },
  returns: v.union(
    registrationResult,
    v.object({ status: v.literal("unknown"), coverage: v.literal("unknown") }),
  ),
  handler: async (ctx, { bucketKey }) => {
    assertSelector(bucketKey);
    const registration = await registrationByKey(ctx, bucketKey);
    return registration
      ? {
          status: "registered" as const,
          coverage: "unknown" as const,
          registration,
        }
      : { status: "unknown" as const, coverage: "unknown" as const };
  },
});
export const discover = query({
  args: { ...ownerFields, paginationOpts: paginationOptsValidator },
  returns: v.object({
    ...paginationResultValidator(registrationDoc).fields,
    coverage: v.literal("unknown"),
    generation: v.number(),
  }),
  handler: async (ctx, args) => {
    assertOwner(args);
    if (
      !Number.isInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > 100
    )
      throw new Error("Ownership page size must be between 1 and 100");
    const generation = (await ownerGeneration(ctx, args))?.generation ?? 0;
    const page = await paginator(ctx.db, schema)
      .query("financialOwnership")
      .withIndex("by_owner", (q) =>
        q.eq("userId", args.userId).eq("orgId", args.orgId),
      )
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        maximumRowsRead: 200,
        maximumBytesRead: 1_000_000,
      });
    return { ...page, coverage: "unknown" as const, generation };
  },
});
