import { paginator } from "convex-helpers/server/pagination";
import schema from "../schema.js";
import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import type { Infer } from "convex/values";
import type { ref } from "./schema.js";
import {
  transferFingerprint,
  transferIdentity,
} from "../financialObservations/transferHelpers.js";
import { bucketDigest, ownerDigest } from "./selectors.js";
export const referenceChunkSize = 64;

/** Only pure derived values are memoized; no source read or financial callback is bypassed. */
export async function reversalReferences(
  ctx: MutationCtx,
  op: Doc<"transferReversalOps">,
  rows: Doc<"transfers">[],
) {
  if (op.slices.length === 0) return [];
  const selected = new Map(rows.map((row) => [row.stripeTransferId, row]));
  const counts = new Map<string, number>();
  for (const row of rows)
    counts.set(
      row.stripeTransferId,
      (counts.get(row.stripeTransferId) ?? 0) + 1,
    );
  const budget = await ctx.meta.getTransactionMetrics();
  const page =
    budget.bytesRead.remaining > 2_500_000 &&
    budget.databaseQueries.remaining > 10
      ? await paginator(ctx.db, schema)
          .query("financialTransferObservations")
          .withIndex("by_source_charge_id", (q) =>
            q.eq("sourceChargeId", op.sourceChargeId),
          )
          .paginate({
            numItems: 1001,
            cursor: null,
            maximumRowsRead: 1001,
            maximumBytesRead: 262144,
          })
      : { page: [] };
  const markers = new Map<
    Id<"transfers">,
    Doc<"financialTransferObservations"> | null
  >();
  for (const marker of page.page)
    markers.set(
      marker.transferId,
      markers.has(marker.transferId) ? null : marker,
    );
  const buckets = new Map<string, Promise<string>>();
  const owners = new Map<string, Promise<string>>();
  const identities = new Map<Id<"transfers">, Promise<string>>();
  const digestFor = (
    key: string,
    cache: Map<string, Promise<string>>,
    calculate: () => Promise<string>,
  ) => {
    let value = cache.get(key);
    if (!value) {
      value = calculate();
      cache.set(key, value);
    }
    return value;
  };
  const capture = async (
    slice: Doc<"transferReversalOps">["slices"][number],
  ): Promise<Infer<typeof ref> | null> => {
    const row = selected.get(slice.stripeTransferId);
    if (!row) return null;
    let identity = identities.get(row._id);
    if (!identity) {
      identity = transferFingerprint(transferIdentity(row));
      identities.set(row._id, identity);
    }
    const [identityFingerprint, bucket] = await Promise.all([
      identity,
      digestFor(row.destinationAccountId, buckets, () =>
        bucketDigest(row.destinationAccountId),
      ),
    ]);
    const marker = markers.get(row._id);
    const usable =
      marker &&
      /^[a-f0-9]{32}$/.test(marker.ownershipFingerprint) &&
      !marker.isContradictory &&
      marker.fingerprint === identityFingerprint &&
      marker.stripeTransferId === slice.stripeTransferId &&
      marker.sourceChargeId === op.sourceChargeId &&
      marker.bucketKey === row.destinationAccountId &&
      marker.role === row.role &&
      Number.isSafeInteger(marker.generation) &&
      marker.generation >= 1;
    const owner =
      usable &&
      marker.registrationId &&
      marker.ownershipStatus === "registered" &&
      marker.userId !== undefined
        ? await digestFor(
            JSON.stringify([marker.userId, marker.orgId]),
            owners,
            () => ownerDigest(marker.userId!, marker.orgId),
          )
        : undefined;
    return {
      transferId: row._id,
      identityFingerprint,
      bucketDigest: bucket,
      ...(owner ? { ownerDigest: owner } : {}),
      ambiguous: counts.get(slice.stripeTransferId) !== 1,
      ...(usable
        ? {
            markerId: marker._id,
            markerGeneration: marker.generation,
            markerIdentityFingerprint: marker.fingerprint,
            ownershipFingerprint: marker.ownershipFingerprint,
            ...(marker.registrationId && marker.ownershipStatus === "registered"
              ? { registrationId: marker.registrationId }
              : {}),
          }
        : {}),
    };
  };
  const result: (Infer<typeof ref> | null)[] = [];
  for (let start = 0; start < op.slices.length; start += referenceChunkSize)
    result.push(
      ...(await Promise.all(
        op.slices.slice(start, start + referenceChunkSize).map(capture),
      )),
    );
  return result;
}
