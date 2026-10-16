import type { MutationCtx } from "../_generated/server.js";
import { observationGeneration } from "./generations.js";
import { transferProducerScope } from "./transferHelpers.js";
import {
  holdTransferBatch,
  isInvalidTransferCursor,
  transferBatchFingerprint,
  type TransferBatch,
} from "./transferContinuationState.js";
import {
  indexTransferReferences,
  validateTransferReferences,
} from "./transferContinuationSteps.js";
/** A stale acknowledgement never advances twice; inter-commit supersession never resets a prefix. */
export async function continueTransferBatch(
  ctx: MutationCtx,
  marker: TransferBatch,
  expectedGeneration: number,
) {
  if (
    marker.generation !== expectedGeneration ||
    marker.isContradictory ||
    marker.continuation?.state === "held"
  )
    return;
  const fingerprint = await transferBatchFingerprint(marker);
  const aliases = await ctx.db
    .query("financialTransferBatches")
    .withIndex("by_original_operation_producer", (q) =>
      q
        .eq("originalOperationId", marker.originalOperationId)
        .eq("producer", marker.producer),
    )
    .take(2);
  if (
    aliases.length !== 1 ||
    aliases[0]._id !== marker._id ||
    isInvalidTransferCursor(marker, fingerprint)
  )
    return holdTransferBatch(ctx, marker);
  // Completion is historical only. A later financial fact does not rewrite that receipt.
  if (marker.state === "complete") return;
  const generation = await observationGeneration(ctx, transferProducerScope);
  if (
    generation === null ||
    (marker.continuation &&
      marker.continuation.producerGeneration !== generation)
  )
    return holdTransferBatch(ctx, marker);
  if (marker.continuation?.state === "validating")
    await validateTransferReferences(ctx, marker);
  else await indexTransferReferences(ctx, marker, fingerprint);
}
