import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import {
  advanceObservationGeneration,
  observationGeneration,
} from "./generations.js";
import {
  transferFingerprint,
  transferProducerScope,
} from "./transferHelpers.js";
export const synchronousTransferFactLimit = 100;
/** Preserve compact source references atomically before the original operation is deleted. */
export async function deferTransferFacts(
  ctx: MutationCtx,
  operation: Doc<"transferReversalOps">,
  transferIds: Id<"transfers">[],
  producer:
    | "transfer_frontier_release"
    | "transfer_frontier_claim" = "transfer_frontier_release",
) {
  const existing = await ctx.db
    .query("financialTransferBatches")
    .withIndex("by_original_operation_producer", (q) =>
      q.eq("originalOperationId", operation._id).eq("producer", producer),
    )
    .take(2);
  const fingerprint = await transferFingerprint({
    operation,
    transferIds,
    producer,
  });
  const prior = existing[0];
  const isContradictory =
    !!prior && (prior.isContradictory || prior.fingerprint !== fingerprint);
  if (
    existing.length === 1 &&
    prior.observedFingerprint === fingerprint &&
    prior.isContradictory === isContradictory
  )
    return;
  if (existing.length === 1) {
    const generation =
      Number.isSafeInteger(prior.generation) &&
      prior.generation >= 1 &&
      Number.isSafeInteger(prior.generation + 1)
        ? prior.generation + 1
        : 0;
    await ctx.db.patch("financialTransferBatches", prior._id, {
      observedFingerprint: fingerprint,
      generation,
      isContradictory: isContradictory || generation === 0,
      ...(isContradictory || generation === 0
        ? {
            state: "pending" as const,
            ...(prior.continuation
              ? {
                  continuation: {
                    ...prior.continuation,
                    state: "held" as const,
                  },
                }
              : {}),
          }
        : {}),
    });
  }
  if (existing.length === 0)
    await ctx.db.insert("financialTransferBatches", {
      originalOperationId: operation._id,
      operationId: operation.operationId,
      sourceChargeId: operation.sourceChargeId,
      producer,
      producerVersion: 1,
      fingerprint,
      observedFingerprint: fingerprint,
      isContradictory: false,
      generation: 1,
      referenceCount: transferIds.length,
      transferIds,
      isOverflow: true,
      state: "pending",
    });
  await advanceObservationGeneration(ctx, transferProducerScope);
}
/** Global invalidation keeps a deferred batch visible even when its owner scopes are not indexed yet. */
export async function transferReaderState(ctx: QueryCtx) {
  const pending = await ctx.db
    .query("financialTransferBatches")
    .withIndex("by_state", (q) => q.eq("state", "pending"))
    .take(1);
  return {
    coverage: "unknown" as const,
    producerGeneration: await observationGeneration(ctx, transferProducerScope),
    hasDeferredWork: pending.length > 0,
  };
}
