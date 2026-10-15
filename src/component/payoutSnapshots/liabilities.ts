import type { QueryCtx, MutationCtx } from "../_generated/server.js";
import { riskRevision } from "./revisions.js";
/** Recovery-backed recipients must carry the version captured with their authorized amount. */
export async function assertLiabilityVersion(
  ctx: QueryCtx | MutationCtx,
  scope: { accountId: string; liabilityRevision?: number },
) {
  if (scope.liabilityRevision === undefined) {
    const recovery = await ctx.db
      .query("recoveryBalances")
      .withIndex("by_scope", (q) => q.eq("accountId", scope.accountId))
      .first();
    if (recovery)
      throw new Error(
        "A versioned recovery liability quote is required before payout qualification.",
      );
    return;
  }
  if (
    !Number.isSafeInteger(scope.liabilityRevision) ||
    scope.liabilityRevision < 0 ||
    scope.liabilityRevision !== (await riskRevision(ctx, scope.accountId))
  )
    throw new Error("Payout liability version changed; resolve a fresh quote.");
}
