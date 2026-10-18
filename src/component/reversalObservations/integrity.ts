import type { Doc } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import {
  sourceFingerprint,
  identityFingerprint,
} from "../operationEvidence/helpers.js";
/** Validate the exact original/latest bytes; exposure is part of provenance too. */
export async function validPayload(
  ctx: QueryCtx,
  header: Doc<"reversalObservations">,
  version: "original" | "latest",
) {
  const row = await ctx.db.get(
    "reversalObservationPayloads",
    version === "original" ? header.originalPayloadId : header.latestPayloadId,
  );
  if (!row) return null;
  const { _id, _creationTime, ...body } = row;
  void _id;
  void _creationTime;
  const full =
    version === "original" ? header.originalFingerprint : header.fingerprint;
  const identity =
    version === "original"
      ? header.originalIdentityFingerprint
      : header.latestIdentityFingerprint;
  return (await sourceFingerprint(body)) === full &&
    (await identityFingerprint(body)) === identity
    ? row
    : null;
}
