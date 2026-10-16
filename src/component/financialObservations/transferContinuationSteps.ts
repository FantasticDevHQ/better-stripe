import type { Doc } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import {
  advanceObservationGeneration,
  observationGeneration,
} from "./generations.js";
import { legOwnership } from "./settlementHelpers.js";
import {
  transferFingerprint,
  transferIdentity,
  transferProducerScope,
} from "./transferHelpers.js";
import { observeTransfer } from "./transfers.js";
import {
  holdTransferBatch,
  transferReferenceBatchLimit,
  type TransferBatch,
} from "./transferContinuationState.js";
async function observationFor(
  ctx: MutationCtx,
  transferId: Doc<"transfers">["_id"],
) {
  const rows = await ctx.db
    .query("financialTransferObservations")
    .withIndex("by_transfer_id", (q) => q.eq("transferId", transferId))
    .take(2);
  return rows.length === 1 ? rows[0] : null;
}
export async function indexTransferReferences(
  ctx: MutationCtx,
  marker: TransferBatch,
  sourceFingerprint: string,
) {
  const start = marker.continuation?.nextReference ?? 0;
  const end = Math.min(
    start + transferReferenceBatchLimit,
    marker.referenceCount,
  );
  const future = await ctx.db
    .query("financialTransferBatchReferences")
    .withIndex("by_batch_position", (q) =>
      q.eq("batchId", marker._id).gte("position", start),
    )
    .take(1);
  if (future.length) return holdTransferBatch(ctx, marker);
  const seen = new Set<string>();
  const rows: Doc<"transfers">[] = [];
  for (let position = start; position < end; position++) {
    const id = marker.transferIds[position]!;
    const previous = await ctx.db
      .query("financialTransferBatchReferences")
      .withIndex("by_batch_transfer", (q) =>
        q.eq("batchId", marker._id).eq("transferId", id),
      )
      .take(1);
    const row = await ctx.db.get("transfers", id);
    if (
      !row ||
      row.sourceChargeId !== marker.sourceChargeId ||
      seen.has(id) ||
      previous.length
    )
      return holdTransferBatch(ctx, marker);
    seen.add(id);
    const aliases = await ctx.db
      .query("transfers")
      .withIndex("by_stripe_transfer_id", (q) =>
        q.eq("stripeTransferId", row.stripeTransferId),
      )
      .take(2);
    const priorRows = await ctx.db
      .query("financialTransferObservations")
      .withIndex("by_transfer_id", (q) => q.eq("transferId", id))
      .take(2);
    const prior = priorRows[0];
    const ownership =
      prior && !prior.registrationId
        ? { ownershipStatus: prior.ownershipStatus }
        : await legOwnership(
            ctx,
            prior?.bucketKey ?? row.destinationAccountId,
            prior,
          );
    if (
      aliases.length !== 1 ||
      aliases[0]._id !== id ||
      priorRows.length > 1 ||
      prior?.isContradictory ||
      ownership.ownershipStatus === "ambiguous" ||
      ownership.ownershipStatus === "contradictory" ||
      (prior &&
        (!Number.isSafeInteger(prior.generation) ||
          prior.generation < 1 ||
          prior.generation === Number.MAX_SAFE_INTEGER ||
          prior.fingerprint !==
            (await transferFingerprint(transferIdentity(row)))))
    )
      return holdTransferBatch(ctx, marker);
    rows.push(row);
  }
  for (let offset = 0; offset < rows.length; offset++) {
    const row = rows[offset]!;
    await observeTransfer(ctx, row, { preserveUnregisteredOwnership: true });
    const observation = await observationFor(ctx, row._id);
    if (
      !observation ||
      observation.isContradictory ||
      observation.generation < 1
    )
      return holdTransferBatch(ctx, marker, start + offset);
    await ctx.db.insert("financialTransferBatchReferences", {
      batchId: marker._id,
      position: start + offset,
      transferId: row._id,
      observationId: observation._id,
      observationGeneration: observation.generation,
      sourceFingerprint: observation.fingerprint,
      observedFingerprint: observation.observedFingerprint,
      ownershipFingerprint: observation.ownershipFingerprint,
    });
  }
  const generation = await observationGeneration(ctx, transferProducerScope);
  if (generation === null) return holdTransferBatch(ctx, marker, end);
  await ctx.db.patch("financialTransferBatches", marker._id, {
    generation: marker.generation + 1,
    continuation: {
      state: end === marker.referenceCount ? "validating" : "indexing",
      nextReference: end,
      validatedReferences: 0,
      producerGeneration: generation,
      sourceFingerprint,
    },
  });
}
async function isInvalidReference(
  ctx: MutationCtx,
  marker: TransferBatch,
  reference: Doc<"financialTransferBatchReferences">,
  position: number,
) {
  if (
    reference.position !== position ||
    reference.transferId !== marker.transferIds[position]
  )
    return true;
  const duplicates = await ctx.db
    .query("financialTransferBatchReferences")
    .withIndex("by_batch_transfer", (q) =>
      q.eq("batchId", marker._id).eq("transferId", reference.transferId),
    )
    .take(2);
  const source = await ctx.db.get("transfers", reference.transferId);
  const observation = await observationFor(ctx, reference.transferId);
  if (
    duplicates.length !== 1 ||
    duplicates[0]._id !== reference._id ||
    !source ||
    source.sourceChargeId !== marker.sourceChargeId ||
    !observation ||
    observation._id !== reference.observationId ||
    observation.isContradictory ||
    observation.generation !== reference.observationGeneration ||
    observation.fingerprint !== reference.sourceFingerprint ||
    observation.observedFingerprint !== reference.observedFingerprint ||
    observation.ownershipFingerprint !== reference.ownershipFingerprint
  )
    return true;
  const ownershipFingerprint = await transferFingerprint({
    registrationId: observation.registrationId,
    userId: observation.userId,
    orgId: observation.orgId,
    ownershipStatus: observation.ownershipStatus,
  });
  if (
    observation.transferId !== source._id ||
    observation.stripeTransferId !== source.stripeTransferId ||
    observation.bucketKey !== source.destinationAccountId ||
    observation.sourceChargeId !== source.sourceChargeId ||
    observation.sourceInvoiceId !== source.sourceInvoiceId ||
    observation.role !== source.role ||
    ownershipFingerprint !== reference.ownershipFingerprint ||
    observation.ownershipStatus === "ambiguous" ||
    observation.ownershipStatus === "contradictory"
  )
    return true;
  const { totalsRecorded, ...financial } = source;
  void totalsRecorded;
  return (
    reference.sourceFingerprint !==
      (await transferFingerprint(transferIdentity(source))) ||
    reference.observedFingerprint !== (await transferFingerprint(financial))
  );
}
export async function validateTransferReferences(
  ctx: MutationCtx,
  marker: TransferBatch,
) {
  const cursor = marker.continuation!;
  const start = cursor.validatedReferences;
  const rows = await ctx.db
    .query("financialTransferBatchReferences")
    .withIndex("by_batch_position", (q) =>
      q.eq("batchId", marker._id).gte("position", start),
    )
    .take(transferReferenceBatchLimit + 1);
  const batch = rows.slice(0, transferReferenceBatchLimit);
  if (
    !batch.length ||
    (rows.length <= transferReferenceBatchLimit &&
      start + batch.length !== marker.referenceCount)
  )
    return holdTransferBatch(ctx, marker);
  for (let i = 0; i < batch.length; i++)
    if (await isInvalidReference(ctx, marker, batch[i]!, start + i))
      return holdTransferBatch(ctx, marker);
  const end = start + batch.length;
  const isComplete = rows.length <= transferReferenceBatchLimit;
  if (isComplete)
    await advanceObservationGeneration(ctx, transferProducerScope);
  const generation = await observationGeneration(ctx, transferProducerScope);
  if (generation === null) return holdTransferBatch(ctx, marker);
  await ctx.db.patch("financialTransferBatches", marker._id, {
    generation: marker.generation + 1,
    state: isComplete ? "complete" : "pending",
    continuation: {
      ...cursor,
      state: isComplete ? "complete" : "validating",
      validatedReferences: end,
      producerGeneration: generation,
    },
  });
}
