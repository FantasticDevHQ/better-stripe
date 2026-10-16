import type { Doc } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { observationGeneration } from "./generations.js";
import {
  transferFingerprint,
  transferProducerScope,
} from "./transferHelpers.js";
export type TransferBatch = Doc<"financialTransferBatches">;
export const transferReferenceBatchLimit = 50;
export function transferBatchFingerprint(marker: TransferBatch) {
  return transferFingerprint({
    originalOperationId: marker.originalOperationId,
    operationId: marker.operationId,
    sourceChargeId: marker.sourceChargeId,
    producer: marker.producer,
    producerVersion: marker.producerVersion,
    fingerprint: marker.fingerprint,
    referenceCount: marker.referenceCount,
    transferIds: marker.transferIds,
  });
}
export async function holdTransferBatch(
  ctx: MutationCtx,
  marker: TransferBatch,
  nextReference = marker.continuation?.nextReference ?? 0,
) {
  const cursor = marker.continuation ?? {
    state: "indexing" as const,
    nextReference: 0,
    validatedReferences: 0,
    producerGeneration:
      (await observationGeneration(ctx, transferProducerScope)) ?? 0,
    sourceFingerprint: await transferBatchFingerprint(marker),
  };
  await ctx.db.patch("financialTransferBatches", marker._id, {
    generation: Number.isSafeInteger(marker.generation + 1)
      ? marker.generation + 1
      : 0,
    state: "pending",
    isContradictory: true,
    continuation: { ...cursor, state: "held", nextReference },
  });
}
export function isInvalidTransferCursor(
  marker: TransferBatch,
  fingerprint: string,
) {
  const c = marker.continuation;
  const count = marker.referenceCount;
  if (
    !Number.isSafeInteger(marker.generation) ||
    marker.generation < 1 ||
    !Number.isSafeInteger(marker.generation + 1) ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count !== marker.transferIds.length ||
    marker.fingerprint !== marker.observedFingerprint
  )
    return true;
  if (!c) return marker.state !== "pending";
  return (
    c.sourceFingerprint !== fingerprint ||
    !Number.isSafeInteger(c.nextReference) ||
    c.nextReference < 0 ||
    c.nextReference > count ||
    !Number.isSafeInteger(c.validatedReferences) ||
    c.validatedReferences < 0 ||
    c.validatedReferences > c.nextReference ||
    !Number.isSafeInteger(c.producerGeneration) ||
    c.producerGeneration < 1 ||
    (c.state === "indexing" &&
      (c.nextReference >= count ||
        c.validatedReferences !== 0 ||
        marker.state !== "pending")) ||
    (c.state === "validating" &&
      (c.nextReference !== count ||
        c.validatedReferences >= count ||
        marker.state !== "pending")) ||
    (c.state === "complete" &&
      (c.nextReference !== count ||
        c.validatedReferences !== count ||
        marker.state !== "complete")) ||
    (marker.state === "complete" && c.state !== "complete")
  );
}
