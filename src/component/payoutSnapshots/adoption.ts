import type { Infer } from "convex/values";
import type { MutationCtx } from "../_generated/server.js";
import type { Id } from "../_generated/dataModel.js";
import type { observation } from "../payoutRelease/schema.js";
import { payoutClaimFingerprint } from "../payoutRelease/helpers.js";
import { collectedSources } from "./financial.js";
import { financialRevision } from "./revisions.js";
/** Import/control validation only. This never authorizes a bank payout or supplies a liability amount. */
export async function adoptionCollection(
  ctx: MutationCtx,
  scope: { accountId: string; ownerKey: string },
  proof: {
    snapshotId?: Id<"payoutSnapshots">;
    observations: Infer<typeof observation>[];
    claims: { operationKey: string; fingerprint: string }[];
  },
) {
  if (!proof.snapshotId) return undefined;
  const h = await ctx.db.get("payoutSnapshots", proof.snapshotId);
  const revision = await financialRevision(ctx, scope.accountId);
  if (
    !h?.readOnly ||
    h.observedRevision !== revision.revision ||
    h.deferredPositiveChanges
  )
    throw new Error(
      "Adoption collection changed; collect complete current funding again.",
    );
  // No money is released here. Capture the current revision under this same
  // transaction; collectedSources also requires the cached risk fence to match.
  const sources = await collectedSources(
    ctx,
    {
      ...scope,
      snapshotId: proof.snapshotId,
      liabilityRevision: revision.riskRevision,
    },
    proof.observations,
  );
  const keys = new Set(proof.claims.map((c) => c.operationKey));
  if (keys.size !== proof.claims.length || keys.size !== h.claimCount)
    throw new Error("Adoption claim membership is incomplete.");
  const claims = [];
  for (const expected of proof.claims) {
    const cached = await ctx.db
      .query("payoutSnapshotClaims")
      .withIndex("by_snapshot_operation", (q) =>
        q.eq("snapshotId", h._id).eq("operationKey", expected.operationKey),
      )
      .unique();
    const row = await ctx.db
      .query("payoutReleaseClaims")
      .withIndex("by_operation", (q) =>
        q.eq("operationKey", expected.operationKey),
      )
      .unique();
    if (
      !cached ||
      !row ||
      row.accountId !== scope.accountId ||
      row.ownerKey !== scope.ownerKey ||
      expected.fingerprint !== cached.fingerprint ||
      expected.fingerprint !== payoutClaimFingerprint(row)
    )
      throw new Error("Adoption payout history changed.");
    claims.push(row);
  }
  return { sources, claims };
}
