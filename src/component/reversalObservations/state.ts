import type { Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { observationGeneration } from "../financialObservations/generations.js";
import { transferProducerScope } from "../financialObservations/transferHelpers.js";
import { lifecycleScope } from "./capture.js";
export async function header(
  ctx: QueryCtx,
  operationId: Id<"transferReversalOps">,
) {
  const rows = await ctx.db
    .query("reversalObservations")
    .withIndex("by_original_operation", (q) =>
      q.eq("originalOperationId", operationId),
    )
    .take(2);
  const row = rows[0];
  return rows.length === 1 &&
    [row.generation, row.sliceCount, row.indexedCount, row.nextIndex].every(
      Number.isSafeInteger,
    ) &&
    row.generation >= 1 &&
    row.sliceCount >= 0 &&
    row.indexedCount >= 0 &&
    row.indexedCount <= row.sliceCount &&
    row.nextIndex >= 0 &&
    row.nextIndex <= row.sliceCount &&
    row.referenceFingerprints.length ===
      (row.legacy ? 0 : Math.ceil(row.sliceCount / 64)) &&
    row.referenceFingerprints.every((value) => /^[a-f0-9]{64}$/.test(value)) &&
    (!(row.status === "complete" || row.status === "validating") ||
      row.indexedCount === row.sliceCount) &&
    (row.status !== "complete" || row.nextIndex === 0)
    ? row
    : null;
}
export async function readState(ctx: QueryCtx) {
  return {
    coverage: "unknown" as const,
    generation: await observationGeneration(ctx, lifecycleScope),
    transferGeneration: await observationGeneration(ctx, transferProducerScope),
  };
}
