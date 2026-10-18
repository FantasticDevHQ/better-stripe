import { bucketDigest, ownerDigest } from "./selectors.js";
import type { Infer } from "convex/values";
import type { ref } from "./schema.js";
import type { MutationCtx } from "../_generated/server.js";
import {
  transferFingerprint,
  transferIdentity,
} from "../financialObservations/transferHelpers.js";
import { legOwnership } from "../financialObservations/settlementHelpers.js";
const compact = (value: string | undefined) =>
  value !== undefined && new TextEncoder().encode(value).length <= 256
    ? value
    : undefined;
/** Original refs and pins are evidence. New registrations never fill old unknown ownership. */
export async function indexSlice(
  ctx: MutationCtx,
  reference: Infer<typeof ref> | null,
  stripeTransferId: string,
  sourceChargeId: string,
) {
  const unknown = {
    ownershipStatus: "unknown" as const,
    identityStatus: "unknown" as const,
    transferGeneration: null,
  };
  if (!reference) return unknown;
  const original = {
    ...unknown,
    transferId: reference.transferId,
    bucketDigest: reference.bucketDigest,
    ...(reference.ownerDigest ? { ownerDigest: reference.ownerDigest } : {}),
    ...(reference.registrationId
      ? { registrationId: reference.registrationId }
      : {}),
  };
  const row = await ctx.db.get("transfers", reference.transferId);
  if (!row) return original;
  if (
    reference.ambiguous ||
    row.stripeTransferId !== stripeTransferId ||
    row.sourceChargeId !== sourceChargeId ||
    (await transferFingerprint(transferIdentity(row))) !==
      reference.identityFingerprint
  )
    return { ...original, identityStatus: "contradictory" as const };
  const sourceRows = await ctx.db
    .query("transfers")
    .withIndex("by_stripe_transfer_id", (q) =>
      q.eq("stripeTransferId", stripeTransferId),
    )
    .take(2);
  if (sourceRows.length !== 1 || sourceRows[0]._id !== row._id)
    return { ...original, identityStatus: "contradictory" as const };
  if ((await bucketDigest(row.destinationAccountId)) !== reference.bucketDigest)
    return null;
  const matched = {
    ...original,
    identityStatus: "matched" as const,
    ...(compact(row.destinationAccountId) !== undefined
      ? { bucketKey: row.destinationAccountId }
      : {}),
  };
  const markers = await ctx.db
    .query("financialTransferObservations")
    .withIndex("by_transfer_id", (q) =>
      q.eq("transferId", reference.transferId),
    )
    .take(2);
  const marker = markers[0];
  const markerMatches =
    markers.length === 1 &&
    marker._id === reference.markerId &&
    !marker.isContradictory &&
    marker.fingerprint === reference.markerIdentityFingerprint &&
    marker.stripeTransferId === stripeTransferId &&
    marker.sourceChargeId === sourceChargeId &&
    marker.bucketKey === row.destinationAccountId &&
    marker.role === row.role;
  const transferGeneration =
    markerMatches &&
    Number.isSafeInteger(marker.generation) &&
    marker.generation >= 1
      ? marker.generation
      : null;
  if (!reference.registrationId || !reference.ownershipFingerprint)
    return { ...matched, transferGeneration };
  const registration = await ctx.db.get(
    "financialOwnership",
    reference.registrationId,
  );
  if (!registration) return { ...matched, transferGeneration };
  if (registration.bucketKey !== row.destinationAccountId) return null;
  const pin = {
    registrationId: registration._id,
    userId: registration.userId,
    orgId: registration.orgId,
  };
  if (
    (await transferFingerprint({ ...pin, ownershipStatus: "registered" })) !==
    reference.ownershipFingerprint
  )
    return null;
  if (
    reference.ownerDigest &&
    (await ownerDigest(pin.userId, pin.orgId)) !== reference.ownerDigest
  )
    return null;
  const live = await legOwnership(ctx, row.destinationAccountId, pin);
  return {
    ...matched,
    transferGeneration,
    ...(reference.ownerDigest &&
    reference.ownerDigest === (await ownerDigest(pin.userId, pin.orgId))
      ? { ownerDigest: reference.ownerDigest }
      : {}),
    ...(compact(pin.userId) !== undefined ? { userId: pin.userId } : {}),
    ...(compact(pin.orgId) !== undefined ? { orgId: pin.orgId } : {}),
    ownershipStatus:
      markerMatches &&
      marker.ownershipFingerprint === reference.ownershipFingerprint
        ? live.ownershipStatus
        : ("contradictory" as const),
  };
}
