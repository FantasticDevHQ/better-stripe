import type { QueryCtx, MutationCtx } from "../_generated/server.js";
import type { PayoutFundingSource } from "./allocation.js";
import { add } from "./helpers.js";
/** Match the maintained source rollups to all persisted claims before using them as financial facts. */
export async function assertAllocationTotals(
  ctx: QueryCtx | MutationCtx,
  scope: { accountId: string; ownerKey: string },
  sources: PayoutFundingSource[],
) {
  const claims = await ctx.db
    .query("payoutReleaseClaims")
    .withIndex("by_account_status", (q) => q.eq("accountId", scope.accountId))
    .take(101);
  if (claims.length > 100)
    throw new Error("Payout claim snapshot is incomplete.");
  const totals = new Map(
    sources.map((source) => [
      source.stripeTransferId,
      { source, paid: 0, reserved: 0 },
    ]),
  );
  for (const claim of claims) {
    if (claim.ownerKey !== scope.ownerKey)
      throw new Error("Payout claim owner does not match.");
    let allocated = 0;
    const seen = new Set<string>();
    for (const allocation of claim.allocations) {
      const total = totals.get(allocation.stripeTransferId);
      if (
        !total ||
        total.source.currency !== claim.currency ||
        seen.has(allocation.stripeTransferId) ||
        !Number.isSafeInteger(allocation.amount) ||
        allocation.amount <= 0
      )
        throw new Error("Payout claim allocation provenance is invalid.");
      seen.add(allocation.stripeTransferId);
      allocated = add(allocated, allocation.amount);
      if (claim.status === "paid")
        total.paid = add(total.paid, allocation.amount);
      if (claim.status === "reserved" || claim.status === "submitted")
        total.reserved = add(total.reserved, allocation.amount);
    }
    if (
      !Number.isSafeInteger(claim.amount) ||
      claim.amount <= 0 ||
      allocated !== claim.amount
    )
      throw new Error("Payout claim allocation principal does not match.");
  }
  for (const { source, paid, reserved } of totals.values())
    if (source.paidAmount !== paid || source.reservedAmount !== reserved)
      throw new Error(
        "Payout allocation totals do not match persisted claims.",
      );
}
