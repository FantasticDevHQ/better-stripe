import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
export type HostOperationRef = {
  accountId: string;
  scopeKey: string;
  currency: string;
  operationId: string;
  version: number;
};
export async function readJob(
  ctx: QueryCtx | MutationCtx,
  ref: HostOperationRef,
) {
  const job = await ctx.db
    .query("recoveryJobs")
    .withIndex("by_operation", (q) => q.eq("operationId", ref.operationId))
    .unique();
  if (
    !job ||
    (["accountId", "scopeKey", "currency", "version"] as const).some(
      (k) => job[k] !== ref[k],
    )
  )
    throw new Error("Recovery operation ownership does not match.");
  const seller = await ctx.db.get("users", job.sellerId);
  if (seller?.role !== "seller" || seller.stripeAccountId !== job.accountId)
    throw new Error("Original recovery owner is unavailable.");
  return job;
}
export const jobReference = (job: Doc<"recoveryJobs">): HostOperationRef => {
  if (!job.operationId || job.version === undefined)
    throw new Error("Recovery operation is awaiting historical mapping.");
  return {
    accountId: job.accountId,
    scopeKey: job.scopeKey,
    currency: job.currency,
    operationId: job.operationId,
    version: job.version,
  };
};
