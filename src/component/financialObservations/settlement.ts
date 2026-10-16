import type { Infer } from "convex/values";
import type { Doc } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { generateIdempotencyKey } from "../lib/idempotency.js";
import {
  advanceObservationGeneration,
  bucketScope,
  ownerScope,
} from "./generations.js";
import type { legDoc } from "./schema.js";

/** Larger valid allocations retain an UNKNOWN marker; BTS-228 owns resumable ALL-leg traversal. */
export const synchronousSettlementLegLimit = 100;
type Leg = Omit<Infer<typeof legDoc>, "_id" | "_creationTime">;
async function legOwnership(
  ctx: MutationCtx,
  bucketKey: string,
  prior: Doc<"financialSourceLegs"> | undefined,
) {
  const registrations = await ctx.db
    .query("financialOwnership")
    .withIndex("by_bucket_key", (q) => q.eq("bucketKey", bucketKey))
    .take(2);
  const registration = registrations[0];
  const pin = prior?.registrationId
    ? {
        registrationId: prior.registrationId,
        userId: prior.userId,
        orgId: prior.orgId,
      }
    : {};
  if (registrations.length > 1)
    return { ...pin, ownershipStatus: "ambiguous" as const };
  if (!registration) return { ...pin, ownershipStatus: "unknown" as const };
  if (
    prior?.registrationId &&
    (prior.registrationId !== registration._id ||
      prior.userId !== registration.userId ||
      prior.orgId !== registration.orgId)
  )
    return { ...pin, ownershipStatus: "contradictory" as const };
  return {
    registrationId: registration._id,
    userId: registration.userId,
    orgId: registration.orgId,
    ownershipStatus: "registered" as const,
  };
}
async function invalidate(ctx: MutationCtx, legs: Leg[]) {
  const scopes = new Set<string>();
  for (const leg of legs) {
    scopes.add(bucketScope(leg.bucketKey));
    if (leg.userId !== undefined) scopes.add(ownerScope(leg.userId, leg.orgId));
  }
  for (const scope of scopes) await advanceObservationGeneration(ctx, scope);
}
function hasInvalidLegIdentity(
  row: Doc<"settlementAllocations">,
  legs: Doc<"financialSourceLegs">[],
) {
  const slots = new Set<number>();
  return legs.some((leg) => {
    const original = row.transfers[leg.legIndex];
    const isInvalid =
      slots.has(leg.legIndex) ||
      !Number.isInteger(leg.legIndex) ||
      !original ||
      leg.sourceChargeId !== row.sourceChargeId ||
      leg.bucketKey !== original.destinationAccountId ||
      leg.role !== original.role;
    slots.add(leg.legIndex);
    return isInvalid;
  });
}

/** Persist diagnostic provenance in the SAME raw mutation; never mutate the financial source. */
export async function observeSettlementAllocation(
  ctx: MutationCtx,
  row: Doc<"settlementAllocations">,
) {
  const markers = await ctx.db
    .query("financialSourceObservations")
    .withIndex("by_allocation_id", (q) => q.eq("allocationId", row._id))
    .take(2);
  if (markers.length > 1) return;
  const prior = markers[0];
  const oldLegs = await ctx.db
    .query("financialSourceLegs")
    .withIndex("by_allocation_id_and_leg_index", (q) =>
      q.eq("allocationId", row._id),
    )
    .take(synchronousSettlementLegLimit + 1);
  const fingerprint = await generateIdempotencyKey(
    "settlement-allocation-observation-v1",
    {
      sourceChargeId: row.sourceChargeId,
      paymentIntentId: row.paymentIntentId,
      sourceInvoiceId: row.sourceInvoiceId,
      gross: row.gross,
      currency: row.currency,
      processingFee: row.processingFee,
      platformNet: row.platformNet,
      adjustmentAmount: row.adjustmentAmount,
      paymentId: row.paymentId,
      transfers: row.transfers,
    },
  );
  const sources = await ctx.db
    .query("settlementAllocations")
    .withIndex("by_source_charge", (q) =>
      q.eq("sourceChargeId", row.sourceChargeId),
    )
    .take(2);
  const hasInvalidLegs =
    hasInvalidLegIdentity(row, oldLegs) ||
    (prior !== undefined &&
      (prior.indexedLegCount !== oldLegs.length ||
        (!prior.isOverflow &&
          !prior.isContradictory &&
          (prior.legCount !== row.transfers.length ||
            oldLegs.length !== row.transfers.length))));
  const isContradictory =
    hasInvalidLegs ||
    sources.length !== 1 ||
    sources[0]?._id !== row._id ||
    prior?.isContradictory === true ||
    (prior !== undefined && prior.fingerprint !== fingerprint) ||
    oldLegs.length > synchronousSettlementLegLimit;
  const isOverflow = row.transfers.length > synchronousSettlementLegLimit;
  const legs: Leg[] = [];
  if (!isOverflow && !isContradictory)
    for (const [legIndex, leg] of row.transfers.entries()) {
      const previous = oldLegs.find((l) => l.legIndex === legIndex);
      legs.push({
        allocationId: row._id,
        sourceChargeId: row.sourceChargeId,
        legIndex,
        bucketKey: leg.destinationAccountId,
        role: leg.role,
        ...(await legOwnership(ctx, leg.destinationAccountId, previous)),
      });
    }
  const ownershipFingerprint = await generateIdempotencyKey(
    "settlement-leg-ownership-v1",
    { legs },
  );
  if (
    prior &&
    prior.observedFingerprint === fingerprint &&
    prior.ownershipFingerprint === ownershipFingerprint &&
    prior.isContradictory === isContradictory &&
    prior.isOverflow === isOverflow
  )
    return;
  const generation = (prior?.generation ?? 0) + 1;
  if (
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    (prior && prior.generation < 1)
  ) {
    if (prior && prior.generation !== 0) {
      await ctx.db.patch("financialSourceObservations", prior._id, {
        generation: 0,
        isContradictory: true,
      });
      await invalidate(ctx, oldLegs);
    }
    return;
  }
  if (!isOverflow && !isContradictory)
    for (const leg of legs) {
      const existing = oldLegs.find((l) => l.legIndex === leg.legIndex);
      if (existing)
        await ctx.db.patch("financialSourceLegs", existing._id, leg);
      else await ctx.db.insert("financialSourceLegs", leg);
    }
  if (isContradictory && !hasInvalidLegs)
    for (const leg of oldLegs)
      await ctx.db.patch("financialSourceLegs", leg._id, {
        ownershipStatus: "contradictory",
      });
  const fields = {
    allocationId: row._id,
    sourceChargeId: prior?.sourceChargeId ?? row.sourceChargeId,
    producer: "settlement_allocation" as const,
    producerVersion: 1 as const,
    fingerprint: prior?.fingerprint ?? fingerprint,
    observedFingerprint: fingerprint,
    ownershipFingerprint,
    generation,
    legCount: row.transfers.length,
    indexedLegCount:
      isOverflow || isContradictory ? oldLegs.length : legs.length,
    isOverflow,
    isContradictory,
  };
  if (prior)
    await ctx.db.patch("financialSourceObservations", prior._id, fields);
  else await ctx.db.insert("financialSourceObservations", fields);
  await invalidate(ctx, [...oldLegs, ...legs]);
}
