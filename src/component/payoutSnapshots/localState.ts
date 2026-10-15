import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import type { Doc } from "../_generated/dataModel.js";
import {
  validateIdentity,
  transferFingerprint,
  payoutClaimFingerprint,
  sourceById,
  add,
} from "../payoutRelease/helpers.js";
export type Snapshot = Doc<"payoutSnapshots">;
export type Counts = Pick<
  Snapshot,
  "sourceCount" | "allocationCount" | "claimCount" | "feeCount"
>;
export class CollectionError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}
export async function ownedSnapshot(
  ctx: MutationCtx | QueryCtx,
  args: { accountId: string; ownerKey: string; operationKey: string },
) {
  validateIdentity(args);
  const row = await ctx.db
    .query("payoutSnapshots")
    .withIndex("by_operation", (q) => q.eq("operationKey", args.operationKey))
    .unique();
  if (
    row &&
    (row.accountId !== args.accountId || row.ownerKey !== args.ownerKey)
  )
    throw new Error("Collection identity cannot be reused.");
  return row;
}
function amount(n: number) {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new CollectionError("financial_arithmetic");
  return n;
}
async function sourceCache(ctx: MutationCtx, h: Snapshot, id: string) {
  return ctx.db
    .query("payoutSnapshotSources")
    .withIndex("by_snapshot_transfer", (q) =>
      q.eq("snapshotId", h._id).eq("stripeTransferId", id),
    )
    .unique();
}
/** Copy actual local economics. This is not a provider receipt or payout authorization. */
export async function cacheSource(
  ctx: MutationCtx,
  h: Snapshot,
  id: string,
  counts: Counts,
  provided?: Doc<"transfers">,
) {
  const row =
    provided ??
    (await ctx.db
      .query("transfers")
      .withIndex("by_stripe_transfer_id", (q) => q.eq("stripeTransferId", id))
      .unique());
  if (!row || row.stripeTransferId !== id)
    throw new CollectionError("source_missing");
  if (row.destinationAccountId !== h.accountId)
    throw new CollectionError("source_scope_changed");
  amount(row.amount);
  amount(row.reversedAmount ?? 0);
  amount(row.reversalClaimedAmount ?? 0);
  const allocated = await sourceById(ctx, id);
  if (
    allocated &&
    (allocated.accountId !== h.accountId || allocated.ownerKey !== h.ownerKey)
  )
    throw new CollectionError("allocation_identity_changed");
  const old = await sourceCache(ctx, h, id);
  const allocationPresent = allocated !== null;
  const fields = {
    stripeTransferId: id,
    ledgerFingerprint: transferFingerprint(row),
    sourceCreatedAt: row._creationTime,
    currency: row.currency,
    amount: row.amount,
    status: row.status,
    role: row.role,
    sourceChargeId: row.sourceChargeId,
    reversedAmount: row.reversedAmount ?? 0,
    reversalClaimedAmount: row.reversalClaimedAmount ?? 0,
    reinstatement: row.reinstatement ?? false,
    allocationPresent,
    allocationCurrency: allocated?.currency,
    paidAmount: amount(allocated?.paidAmount ?? 0),
    reservedAmount: amount(allocated?.reservedAmount ?? 0),
    needsCheck: true,
  };
  if (old) {
    if (old.allocationPresent && !allocationPresent)
      throw new CollectionError("allocation_removed");
    if (!old.allocationPresent && allocationPresent)
      counts.allocationCount = add(counts.allocationCount, 1);
    await ctx.db.patch("payoutSnapshotSources", old._id, fields);
    return { ...old, ...fields };
  }
  const sourceId = await ctx.db.insert("payoutSnapshotSources", {
    snapshotId: h._id,
    ...fields,
    expectedPaid: 0,
    expectedReserved: 0,
  });
  counts.sourceCount = add(counts.sourceCount, 1);
  if (allocationPresent)
    counts.allocationCount = add(counts.allocationCount, 1);
  return { _id: sourceId, ...fields, expectedPaid: 0, expectedReserved: 0 };
}
async function applyClaimContribution(
  ctx: MutationCtx,
  h: Snapshot,
  claim: Pick<
    Doc<"payoutSnapshotClaims">,
    "allocations" | "status" | "currency"
  >,
  sign: 1 | -1,
  counts: Counts,
) {
  const paid = claim.status === "paid",
    reserved = claim.status === "reserved" || claim.status === "submitted";
  if (!paid && !reserved) return;
  for (const a of claim.allocations) {
    const source =
      (await sourceCache(ctx, h, a.stripeTransferId)) ??
      (await cacheSource(ctx, h, a.stripeTransferId, counts));
    if (
      source.allocationCurrency !== undefined &&
      source.allocationCurrency !== claim.currency
    )
      throw new CollectionError("allocation_currency_changed");
    const expectedPaid = add(source.expectedPaid, paid ? sign * a.amount : 0),
      expectedReserved = add(
        source.expectedReserved,
        reserved ? sign * a.amount : 0,
      );
    if (expectedPaid < 0 || expectedReserved < 0)
      throw new CollectionError("allocation_rollup_underflow");
    await ctx.db.patch("payoutSnapshotSources", source._id, {
      expectedPaid,
      expectedReserved,
      needsCheck: true,
    });
  }
}
export async function cacheClaim(
  ctx: MutationCtx,
  h: Snapshot,
  key: string,
  counts: Counts,
) {
  const row = await ctx.db
    .query("payoutReleaseClaims")
    .withIndex("by_operation", (q) => q.eq("operationKey", key))
    .unique();
  if (!row) throw new CollectionError("claim_removed");
  if (row.accountId !== h.accountId || row.ownerKey !== h.ownerKey)
    throw new CollectionError("claim_identity_changed");
  let total = 0;
  const ids = new Set<string>();
  for (const a of row.allocations) {
    if (ids.has(a.stripeTransferId) || amount(a.amount) === 0)
      throw new CollectionError("allocation_amount_mismatch");
    ids.add(a.stripeTransferId);
    total = add(total, a.amount);
  }
  if (total !== row.amount || total <= 0)
    throw new CollectionError("allocation_amount_mismatch");
  for (const a of row.allocations) {
    const source =
      (await sourceCache(ctx, h, a.stripeTransferId)) ??
      (await cacheSource(ctx, h, a.stripeTransferId, counts));
    if ((source.allocationCurrency ?? source.currency) !== row.currency)
      throw new CollectionError("allocation_currency_changed");
  }
  const old = await ctx.db
    .query("payoutSnapshotClaims")
    .withIndex("by_snapshot_operation", (q) =>
      q.eq("snapshotId", h._id).eq("operationKey", key),
    )
    .unique();
  const fingerprint = payoutClaimFingerprint(row);
  if (old?.fingerprint === fingerprint) return;
  if (old) await applyClaimContribution(ctx, h, old, -1, counts);
  const fields = {
    operationKey: key,
    fingerprint,
    currency: row.currency,
    amount: row.amount,
    status: row.status,
    stripePayoutId: row.stripePayoutId,
    historical: row.historical,
    providerFee: row.providerFee,
    allocations: row.allocations,
  };
  await applyClaimContribution(ctx, h, fields, 1, counts);
  if (old) await ctx.db.patch("payoutSnapshotClaims", old._id, fields);
  else {
    await ctx.db.insert("payoutSnapshotClaims", {
      snapshotId: h._id,
      ...fields,
    });
    counts.claimCount = add(counts.claimCount, 1);
  }
}
export async function cacheFee(
  ctx: MutationCtx,
  h: Snapshot,
  currency: string,
  counts: Counts,
) {
  const row = await ctx.db
    .query("payoutFeeBalances")
    .withIndex("by_account_currency", (q) =>
      q.eq("accountId", h.accountId).eq("currency", currency),
    )
    .unique();
  if (!row) throw new CollectionError("fee_ledger_removed");
  if (row.ownerKey !== h.ownerKey)
    throw new CollectionError("fee_identity_changed");
  const old = await ctx.db
    .query("payoutSnapshotFees")
    .withIndex("by_snapshot_currency", (q) =>
      q.eq("snapshotId", h._id).eq("currency", currency),
    )
    .unique();
  const fields = {
    currency,
    amount: amount(row.amount),
    revision: amount(row.revision),
  };
  if (old) await ctx.db.patch("payoutSnapshotFees", old._id, fields);
  else {
    await ctx.db.insert("payoutSnapshotFees", { snapshotId: h._id, ...fields });
    counts.feeCount = add(counts.feeCount, 1);
  }
}
