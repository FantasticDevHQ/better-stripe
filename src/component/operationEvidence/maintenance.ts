import type { Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import {
  advanceObservationGeneration,
  observationGeneration,
} from "../financialObservations/generations.js";
import {
  bodyOf,
  identityFingerprint,
  operationEvidenceScope,
  selectorDigest,
  sourceFingerprint,
  uniqueSourceHeader,
} from "./helpers.js";

/** Explicit evidence maintenance only. Never called from a financial writer here. */
export async function captureSource(
  ctx: MutationCtx,
  sourceId: Id<"transferReversalOps">,
) {
  const { headers, header } = await uniqueSourceHeader(ctx, sourceId);
  if (headers.length > 1 || (headers.length === 1 && !header))
    return { status: "unavailable" as const, header: null };
  const source = await ctx.db.get("transferReversalOps", sourceId);
  if (!source) return { status: "source_unavailable" as const, header };
  const body = bodyOf(source);
  const fingerprint = await sourceFingerprint(body);
  if (header?.latestFingerprint === fingerprint)
    return { status: "unchanged" as const, header };
  const generation = await observationGeneration(ctx, operationEvidenceScope);
  if (
    generation === null ||
    generation >= Number.MAX_SAFE_INTEGER ||
    (header && header.generation >= Number.MAX_SAFE_INTEGER)
  )
    throw new Error("Operation evidence generation unavailable");
  const identity = await identityFingerprint(body);
  if (header) {
    await ctx.db.replace(
      "operationEvidencePayloads",
      header.latestPayloadId,
      body,
    );
    await ctx.db.patch("operationEvidenceHeaders", header._id, {
      latestFingerprint: fingerprint,
      generation: header.generation + 1,
      isContradictory:
        header.isContradictory ||
        header.originalIdentityFingerprint !== identity,
    });
    await advanceObservationGeneration(ctx, operationEvidenceScope);
    return {
      status: "updated" as const,
      header: (await ctx.db.get("operationEvidenceHeaders", header._id))!,
    };
  }
  const originalPayloadId = await ctx.db.insert(
    "operationEvidencePayloads",
    body,
  );
  const latestPayloadId = await ctx.db.insert(
    "operationEvidencePayloads",
    body,
  );
  const id = await ctx.db.insert("operationEvidenceHeaders", {
    sourceId,
    originalPayloadId,
    latestPayloadId,
    producer: "trusted_host_maintenance",
    producerVersion: 1,
    firstObservedAt: Date.now(),
    sourceCreatedAt: source._creationTime,
    originalFingerprint: fingerprint,
    latestFingerprint: fingerprint,
    originalIdentityFingerprint: identity,
    operationDigest: await selectorDigest("operationId", body.operationId),
    sourceChargeDigest: await selectorDigest(
      "sourceChargeId",
      body.sourceChargeId,
    ),
    generation: 1,
    isContradictory: false,
  });
  await advanceObservationGeneration(ctx, operationEvidenceScope);
  return {
    status: "captured" as const,
    header: (await ctx.db.get("operationEvidenceHeaders", id))!,
  };
}
