import { assertLiabilityVersion } from "./liabilities.js";
import type { Infer } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import type { Id, Doc } from "../_generated/dataModel.js";
import type { observation } from "../payoutRelease/schema.js";
import { readPolicy } from "../payoutPolicy/helpers.js";
import { riskRevision } from "./revisions.js";
export type CollectionScope = {
  accountId: string;
  ownerKey: string;
  snapshotId?: Id<"payoutSnapshots">;
  operationKey?: string;
  liabilityRevision?: number;
};
/** The complete collector baseline is checked again under the claim's OCC transaction. */
export async function collectedSources(
  ctx: QueryCtx | MutationCtx,
  scope: CollectionScope,
  observations: Infer<typeof observation>[],
) {
  if (!scope.snapshotId) {
    await assertLiabilityVersion(ctx, scope);
    return undefined;
  }
  const h = await ctx.db.get("payoutSnapshots", scope.snapshotId);
  const policy = await readPolicy(ctx, scope);
  if (
    !h ||
    h.accountId !== scope.accountId ||
    h.ownerKey !== scope.ownerKey ||
    h.phase !== "local_ready" ||
    h.expiresAt <= Date.now() ||
    h.expectedRevision !== policy?.revision ||
    h.policyMode !== policy?.mode ||
    h.policyOperationKey !== policy?.operationKey ||
    (!h.readOnly && h.boundOperationKey !== scope.operationKey) ||
    (await riskRevision(ctx, scope.accountId)) !==
      (h.readOnly ? h.riskRevision : h.boundRiskRevision)
  )
    throw new Error("Financial payout collection changed or is unavailable.");
  if (h.readOnly) await assertLiabilityVersion(ctx, scope);
  if (
    observations.length !== h.sourceCount ||
    new Set(observations.map((o) => o.stripeTransferId)).size !== h.sourceCount
  )
    throw new Error("Financial payout collection membership is incomplete.");
  const rows = new Map<string, Doc<"transfers">>();
  for (const o of observations) {
    const cached = await ctx.db
      .query("payoutSnapshotSources")
      .withIndex("by_snapshot_transfer", (q) =>
        q.eq("snapshotId", h._id).eq("stripeTransferId", o.stripeTransferId),
      )
      .unique();
    const row = await ctx.db
      .query("transfers")
      .withIndex("by_stripe_transfer_id", (q) =>
        q.eq("stripeTransferId", o.stripeTransferId),
      )
      .unique();
    if (
      !cached ||
      !row ||
      cached.needsCheck ||
      cached.ledgerFingerprint !== o.ledgerFingerprint ||
      cached.expectedPaid !== cached.paidAmount ||
      cached.expectedReserved !== cached.reservedAmount
    )
      throw new Error("Financial payout collection source changed.");
    if (h.readOnly) {
      const allocation = await ctx.db
        .query("payoutSourceAllocations")
        .withIndex("by_transfer", (q) =>
          q.eq("stripeTransferId", o.stripeTransferId),
        )
        .unique();
      if (
        (allocation?.paidAmount ?? 0) !== cached.paidAmount ||
        (allocation?.reservedAmount ?? 0) !== cached.reservedAmount ||
        (allocation &&
          (allocation.accountId !== scope.accountId ||
            allocation.ownerKey !== scope.ownerKey ||
            allocation.currency !== o.currency))
      )
        throw new Error("Financial payout collection allocation changed.");
    }
    rows.set(o.stripeTransferId, row);
  }
  return rows;
}
export async function bindCollection(
  ctx: MutationCtx,
  claim: Doc<"payoutReleaseClaims">,
) {
  if (!claim.snapshotId) return;
  await ctx.db.patch("payoutSnapshots", claim.snapshotId, {
    readOnly: false,
    boundOperationKey: claim.operationKey,
    boundRiskRevision: await riskRevision(ctx, claim.accountId),
  });
}
/** The immutable claim retains all financial proof; only its disposable cache becomes discardable. */
export async function retireCollection(
  ctx: MutationCtx,
  claim: Doc<"payoutReleaseClaims">,
) {
  if (!claim.snapshotId) return;
  const h = await ctx.db.get("payoutSnapshots", claim.snapshotId);
  if (!h || h.readOnly) return;
  if (
    h.accountId !== claim.accountId ||
    h.ownerKey !== claim.ownerKey ||
    h.boundOperationKey !== claim.operationKey
  )
    throw new Error("Financial payout collection binding changed.");
  await ctx.db.patch("payoutSnapshots", h._id, {
    readOnly: true,
    phase: "invalidated",
    reason: "financial_consumed",
  });
}
