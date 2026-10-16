import type { Doc } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import {
  hasInvalidLegIdentity,
  invalidate,
  legOwnership,
  settlementFingerprint,
} from "./settlementHelpers.js";

type Observation = Doc<"financialSourceObservations">;
const batchLimit = 100;
async function hold(ctx: MutationCtx, marker: Observation) {
  await ctx.db.patch("financialSourceObservations", marker._id, {
    isContradictory: true,
    generation: Number.isSafeInteger(marker.generation + 1)
      ? marker.generation + 1
      : 0,
    continuation: {
      state: "held",
      nextLeg: marker.indexedLegCount,
      validatedLegs: marker.continuation?.validatedLegs ?? 0,
    },
  });
}
async function indexBatch(
  ctx: MutationCtx,
  row: Doc<"settlementAllocations">,
  marker: Observation,
) {
  const start = marker.continuation?.nextLeg ?? 0;
  const end = Math.min(start + batchLimit, row.transfers.length);
  const existing = await ctx.db
    .query("financialSourceLegs")
    .withIndex("by_allocation_id_and_leg_index", (q) =>
      q.eq("allocationId", row._id).gte("legIndex", start),
    )
    .take(1);
  if (existing.length) return hold(ctx, marker);
  const legs: Omit<Doc<"financialSourceLegs">, "_id" | "_creationTime">[] = [];
  for (let i = start; i < end; i++) {
    const original = row.transfers[i]!;
    const leg = {
      allocationId: row._id,
      sourceChargeId: row.sourceChargeId,
      legIndex: i,
      bucketKey: original.destinationAccountId,
      role: original.role,
      ...(await legOwnership(ctx, original.destinationAccountId, undefined)),
    };
    legs.push(leg);
    await ctx.db.insert("financialSourceLegs", leg);
  }
  await invalidate(ctx, legs);
  await ctx.db.patch("financialSourceObservations", marker._id, {
    generation: marker.generation + 1,
    indexedLegCount: end,
    continuation: {
      state: end === row.transfers.length ? "validating" : "indexing",
      nextLeg: end,
      validatedLegs: 0,
    },
  });
}
async function validateBatch(
  ctx: MutationCtx,
  row: Doc<"settlementAllocations">,
  marker: Observation,
) {
  const start = marker.continuation!.validatedLegs;
  const legs = await ctx.db
    .query("financialSourceLegs")
    .withIndex("by_allocation_id_and_leg_index", (q) => {
      const allocation = q.eq("allocationId", row._id);
      return start === 0 ? allocation : allocation.gte("legIndex", start);
    })
    .take(batchLimit + 1);
  const batch = legs.slice(0, batchLimit);
  if (
    hasInvalidLegIdentity(row, legs) ||
    batch.some((leg, i) => leg.legIndex !== start + i) ||
    (legs.length <= batchLimit && start + batch.length !== row.transfers.length)
  )
    return hold(ctx, marker);
  for (const leg of batch) {
    const ownership = await legOwnership(ctx, leg.bucketKey, leg);
    if (
      JSON.stringify(ownership) !==
      JSON.stringify({
        registrationId: leg.registrationId,
        userId: leg.userId,
        orgId: leg.orgId,
        ownershipStatus: leg.ownershipStatus,
      })
    ) {
      await ctx.db.patch("financialSourceLegs", leg._id, ownership);
      await invalidate(ctx, [leg, { ...leg, ...ownership }]);
    }
  }
  const validatedLegs = start + batch.length;
  await ctx.db.patch("financialSourceObservations", marker._id, {
    generation: marker.generation + 1,
    continuation: {
      state: legs.length <= batchLimit ? "complete" : "validating",
      nextLeg: marker.indexedLegCount,
      validatedLegs,
    },
  });
}
/** One atomic bounded step. Callers drain explicitly; a stale acknowledgement never advances twice. */
export async function continueSettlementObservation(
  ctx: MutationCtx,
  marker: Observation,
  expectedGeneration: number,
) {
  if (
    marker.generation !== expectedGeneration ||
    marker.isContradictory ||
    !marker.isOverflow ||
    marker.continuation?.state === "held"
  )
    return;
  const row = await ctx.db.get("settlementAllocations", marker.allocationId);
  const candidates = await ctx.db
    .query("settlementAllocations")
    .withIndex("by_source_charge", (q) =>
      q.eq("sourceChargeId", marker.sourceChargeId),
    )
    .take(2);
  const cursor = marker.continuation;
  if (
    !row ||
    candidates.length !== 1 ||
    candidates[0]?._id !== row._id ||
    marker.sourceChargeId !== row.sourceChargeId ||
    marker.fingerprint !== (await settlementFingerprint(row)) ||
    marker.legCount !== row.transfers.length ||
    !Number.isSafeInteger(marker.generation + 1) ||
    marker.generation < 1 ||
    !Number.isInteger(marker.indexedLegCount) ||
    marker.indexedLegCount < 0 ||
    marker.indexedLegCount > row.transfers.length ||
    (cursor
      ? cursor.nextLeg !== marker.indexedLegCount ||
        !Number.isInteger(cursor.validatedLegs) ||
        cursor.validatedLegs < 0 ||
        cursor.validatedLegs > cursor.nextLeg ||
        (cursor.state === "indexing" && cursor.validatedLegs !== 0) ||
        (cursor.state === "validating" &&
          cursor.nextLeg !== row.transfers.length)
      : marker.indexedLegCount !== 0)
  )
    return hold(ctx, marker);
  if (cursor?.state === "complete") return;
  if (cursor?.state === "validating") await validateBatch(ctx, row, marker);
  else await indexBatch(ctx, row, marker);
}
