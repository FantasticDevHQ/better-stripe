import { getConvexSize } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import { sameJSON } from "../renewalOperations/attachValidation.js";
import {
  witnessNeed as need,
  witnessIdentity,
  type WitnessIdentity,
} from "../../shared/renewalWitness.js";
import { normalizedWitnessIdentity } from "./source.js";
import { validateWitness } from "./eligibility.js";

type Reader = Pick<QueryCtx, "db">;
async function find(ctx: Reader, identity: WitnessIdentity) {
  const rows = await ctx.db
    .query("renewalObservationWitnesses")
    .withIndex("by_componentScope_and_witnessId", (q) =>
      q
        .eq("identity.componentScope", identity.componentScope)
        .eq("identity.witnessId", identity.witnessId),
    )
    .take(2);
  need(rows.length <= 1);
  return rows[0] ?? null;
}
function budget(admitted: Awaited<ReturnType<typeof validateWitness>>) {
  const { payload, fields, payloadBinding } = admitted;
  need(
    getConvexSize({
      identity: fields.identity,
      payloadJSON: payload.json,
      payloadBinding,
    }) <= 500000,
  );
  // Reserve the maximum admitted opaque ID length before making any insert.
  need(
    getConvexSize({
      descriptor: { ...fields, payloadBinding, witnessRowId: "x".repeat(255) },
      payloadJSON: payload.json,
    }) <= 500000,
  );
}
async function checked(
  ctx: Reader,
  row: NonNullable<Awaited<ReturnType<typeof find>>>,
) {
  const admitted = await validateWitness(ctx, row.payloadJSON);
  budget(admitted);
  need(
    sameJSON(admitted.fields.identity, row.identity) &&
      admitted.payloadBinding === row.payloadBinding,
  );
  return {
    descriptor: {
      ...admitted.fields,
      payloadBinding: admitted.payloadBinding,
      witnessRowId: row._id,
    },
    payloadJSON: admitted.payload.json,
  };
}
/** Trusted component helper only. A host retention capability and live capture remain required. */
export async function retainWitness(
  ctx: Pick<MutationCtx, "db">,
  args: { identity: WitnessIdentity; payloadJSON: string },
) {
  const identity = normalizedWitnessIdentity(ctx, args.identity);
  const admitted = await validateWitness(ctx, args.payloadJSON);
  need(sameJSON(admitted.fields.identity, identity));
  budget(admitted);
  const existing = await find(ctx, identity);
  if (existing) {
    const original = await checked(ctx, existing);
    if (
      existing.payloadJSON !== admitted.payload.json ||
      !sameJSON(existing.identity, identity)
    )
      return {
        status: "conflict" as const,
        reason: "identity_changed" as const,
      };
    return { status: "retained" as const, descriptor: original.descriptor };
  }
  const witnessRowId = await ctx.db.insert("renewalObservationWitnesses", {
    identity,
    payloadJSON: admitted.payload.json,
    payloadBinding: admitted.payloadBinding,
  });
  return {
    status: "retained" as const,
    descriptor: {
      ...admitted.fields,
      payloadBinding: admitted.payloadBinding,
      witnessRowId,
    },
  };
}
/** Fresh host read authorization belongs to the caller; this cannot establish public ACK delivery. */
export async function readWitness(ctx: Reader, raw: WitnessIdentity) {
  const identity = witnessIdentity(raw);
  const row = await find(ctx, identity);
  if (!row || !sameJSON(row.identity, identity)) return null;
  return checked(ctx, row);
}
