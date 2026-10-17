import type { Infer } from "convex/values";
import type { Doc } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { generateIdempotencyKey } from "../lib/idempotency.js";
import {
  hasInvalidLegIdentity,
  invalidate,
  legOwnership,
  settlementFingerprint,
} from "./settlementHelpers.js";
import type { legDoc } from "./schema.js";

/** Larger allocations require explicit bounded continuation; aggregate coverage stays UNKNOWN. */
export const synchronousSettlementLegLimit = 100;
type Leg = Omit<Infer<typeof legDoc>, "_id" | "_creationTime">;

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
  const fingerprint = await settlementFingerprint(row);
  const sources = await ctx.db
    .query("settlementAllocations")
    .withIndex("by_source_charge", (q) =>
      q.eq("sourceChargeId", row.sourceChargeId),
    )
    .take(2);
  const isContinuedOverflow =
    prior?.isOverflow === true && prior.continuation !== undefined;
  const hasInvalidLegs =
    hasInvalidLegIdentity(row, oldLegs) ||
    (prior !== undefined &&
      ((!isContinuedOverflow && prior.indexedLegCount !== oldLegs.length) ||
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
    (oldLegs.length > synchronousSettlementLegLimit && !isContinuedOverflow);
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
  if (isContinuedOverflow && !isContradictory) return;
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
    indexedLegCount: isContinuedOverflow
      ? prior.indexedLegCount
      : isOverflow || isContradictory
        ? oldLegs.length
        : legs.length,
    ...(prior?.continuation && isContradictory
      ? {
          continuation: {
            ...prior.continuation,
            state: "held" as const,
          },
        }
      : {}),
    isOverflow,
    isContradictory,
  };
  if (prior)
    await ctx.db.patch("financialSourceObservations", prior._id, fields);
  else await ctx.db.insert("financialSourceObservations", fields);
  await invalidate(ctx, [...oldLegs, ...legs]);
}
