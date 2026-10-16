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

type Leg = Omit<Infer<typeof legDoc>, "_id" | "_creationTime">;
export async function legOwnership(
  ctx: MutationCtx,
  bucketKey: string,
  prior:
    | Pick<Doc<"financialSourceLegs">, "registrationId" | "userId" | "orgId">
    | undefined,
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
export async function invalidate(
  ctx: MutationCtx,
  legs: Pick<Leg, "bucketKey" | "userId" | "orgId">[],
) {
  const scopes = new Set<string>();
  for (const leg of legs) {
    scopes.add(bucketScope(leg.bucketKey));
    if (leg.userId !== undefined) scopes.add(ownerScope(leg.userId, leg.orgId));
  }
  for (const scope of scopes) await advanceObservationGeneration(ctx, scope);
}
export function hasInvalidLegIdentity(
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

export async function settlementFingerprint(row: Doc<"settlementAllocations">) {
  return generateIdempotencyKey("settlement-allocation-observation-v1", {
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
  });
}
