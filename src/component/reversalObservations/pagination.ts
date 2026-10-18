import { v } from "convex/values";
import type { Validator } from "convex/values";
import type { PaginationOptions } from "convex/server";
export const readFields = {
  coverage: v.literal("unknown"),
  generation: v.union(v.number(), v.null()),
  transferGeneration: v.union(v.number(), v.null()),
};
export function pageResult<T>(doc: Validator<T, "required", string>) {
  return v.object({
    ...readFields,
    page: v.array(doc),
    isDone: v.boolean(),
    continueCursor: v.string(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(
      v.union(
        v.literal("SplitRecommended"),
        v.literal("SplitRequired"),
        v.null(),
      ),
    ),
  });
}
export function boundedPage(options: PaginationOptions) {
  if (
    !Number.isInteger(options.numItems) ||
    options.numItems < 1 ||
    options.numItems > 100
  )
    throw new Error("Reversal observation pages must contain 1 to 100 rows.");
  for (const value of [options.maximumBytesRead, options.maximumRowsRead])
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1))
      throw new Error("Invalid pagination read budget.");
  return {
    ...options,
    maximumRowsRead: Math.min(options.maximumRowsRead ?? 100, 100),
    maximumBytesRead: Math.min(options.maximumBytesRead ?? 262144, 262144),
  };
}
