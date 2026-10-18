import { canonicalFingerprint } from "../operationEvidence/canonical.js";
import { reversalReferences, referenceChunkSize } from "./references.js";
import type { Doc } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import {
  bodyOf,
  identityFingerprint,
  selectorDigest,
  sourceFingerprint,
} from "../operationEvidence/helpers.js";

import { advanceObservationGeneration } from "../financialObservations/generations.js";
export const lifecycleScope = "reversal-claim-lifecycle-v1";

/** Called inside financial claim/replay/release transactions, including raw handlers. */
export async function captureReversal(
  ctx: MutationCtx,
  op: Doc<"transferReversalOps">,
  deleted = false,
  originalRows?: Doc<"transfers">[],
) {
  const headers = await ctx.db
    .query("reversalObservations")
    .withIndex("by_original_operation", (q) =>
      q.eq("originalOperationId", op._id),
    )
    .take(2);
  const prior = headers[0];
  if (
    headers.length > 1 ||
    (prior &&
      (!Number.isSafeInteger(prior.generation) ||
        prior.generation < 1 ||
        prior.generation >= Number.MAX_SAFE_INTEGER))
  ) {
    await advanceObservationGeneration(ctx, lifecycleScope);
    return;
  }
  const body = bodyOf(op);
  const fingerprint = await sourceFingerprint(body);
  if (prior?.fingerprint === fingerprint && prior.deleted === deleted) return;
  const identity = await identityFingerprint(body);
  if (prior) {
    let latestPayloadId = prior.latestPayloadId;
    if (prior.fingerprint !== fingerprint) {
      if (prior.latestPayloadId === prior.originalPayloadId)
        latestPayloadId = await ctx.db.insert(
          "reversalObservationPayloads",
          body,
        );
      else
        await ctx.db.replace(
          "reversalObservationPayloads",
          latestPayloadId,
          body,
        );
    }
    const isContradictory =
      prior.isContradictory || prior.originalIdentityFingerprint !== identity;
    await ctx.db.patch("reversalObservations", prior._id, {
      latestPayloadId,
      latestIdentityFingerprint: identity,
      fingerprint,
      deleted,
      generation: prior.generation + 1,
      isContradictory,
      status:
        prior.legacy || isContradictory
          ? "held"
          : prior.sliceCount === 0
            ? "complete"
            : "pending",
      nextIndex: 0,
    });
    await advanceObservationGeneration(ctx, lifecycleScope);
    return;
  }
  const refs = originalRows
    ? await reversalReferences(ctx, op, originalRows)
    : [];
  const chunks = [];
  for (let offset = 0; offset < refs.length; offset += referenceChunkSize)
    chunks.push(refs.slice(offset, offset + referenceChunkSize));
  const referenceFingerprints = await Promise.all(
    chunks.map((refs) => canonicalFingerprint({ refs })),
  );
  const originalPayloadId = await ctx.db.insert(
    "reversalObservationPayloads",
    body,
  );
  const id = await ctx.db.insert("reversalObservations", {
    originalOperationId: op._id,
    sourceCreatedAt: op._creationTime,
    producer: "reversal_claim_lifecycle",
    producerVersion: 1,
    originalPayloadId,
    latestPayloadId: originalPayloadId,
    referenceFingerprints,
    originalFingerprint: fingerprint,
    latestIdentityFingerprint: identity,
    originalIdentityFingerprint: identity,
    fingerprint,
    operationDigest: await selectorDigest("operationId", op.operationId),
    sourceChargeDigest: await selectorDigest(
      "sourceChargeId",
      op.sourceChargeId,
    ),
    generation: 1,
    deleted,
    sliceCount: op.slices.length,
    indexedCount: 0,
    nextIndex: 0,
    status: originalRows
      ? op.slices.length === 0
        ? "complete"
        : "pending"
      : "held",
    legacy: !originalRows,
    isContradictory: false,
    indexTransferGeneration: null,
  });
  for (let index = 0; index < chunks.length; index++)
    await ctx.db.insert("reversalObservationRefs", {
      observationId: id,
      chunkIndex: index,
      refs: chunks[index],
    });
  await advanceObservationGeneration(ctx, lifecycleScope);
}
