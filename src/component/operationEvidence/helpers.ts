import type { Doc, Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { observationGeneration } from "../financialObservations/generations.js";
import { canonicalFingerprint } from "./canonical.js";

export const operationEvidenceScope = "operation-evidence-maintenance-v1";
export async function readState(ctx: QueryCtx) {
  return {
    coverage: "unknown" as const,
    evidenceGeneration: await observationGeneration(
      ctx,
      operationEvidenceScope,
    ),
  };
}
export function bodyOf(
  row: Doc<"transferReversalOps"> | Doc<"operationEvidencePayloads">,
) {
  const { _id, _creationTime, ...fields } = row;
  void _id;
  void _creationTime;
  return fields;
}
export function sourceFingerprint(body: ReturnType<typeof bodyOf>) {
  return canonicalFingerprint({ domain: "operation-evidence-source-v1", body });
}
export function identityFingerprint(body: ReturnType<typeof bodyOf>) {
  return canonicalFingerprint({
    domain: "operation-evidence-identity-v1",
    operationId: body.operationId,
    sourceChargeId: body.sourceChargeId,
    slices: body.slices,
  });
}
export function selectorDigest(
  selector: "operationId" | "sourceChargeId",
  value: string,
) {
  return canonicalFingerprint({
    domain: "operation-evidence-selector-v1",
    selector,
    value,
  });
}
export function isValidHeader(header: Doc<"operationEvidenceHeaders">) {
  return (
    Number.isSafeInteger(header.generation) &&
    header.generation >= 1 &&
    header.originalPayloadId !== header.latestPayloadId
  );
}
export async function uniqueSourceHeader(
  ctx: QueryCtx,
  sourceId: Id<"transferReversalOps">,
) {
  const headers = await ctx.db
    .query("operationEvidenceHeaders")
    .withIndex("by_source_id", (q) => q.eq("sourceId", sourceId))
    .take(2);
  return {
    headers,
    header:
      headers.length === 1 && isValidHeader(headers[0]!) ? headers[0]! : null,
  };
}
