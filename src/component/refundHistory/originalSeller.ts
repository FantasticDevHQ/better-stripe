import type { QueryCtx } from "../_generated/server.js";
import type { Doc } from "../_generated/dataModel.js";
import type { RefundCommandScope } from "../../shared/refundCommandScope.js";

const account = (value: string) => /^acct_[A-Za-z0-9_]{1,128}$/.test(value);

/** Immutable allocation routing only. Observation does not authorize a refund. */
function seller(allocation: Doc<"settlementAllocations">): string | undefined {
  const destinations = new Set<string>();
  let store: string | undefined;
  for (const recipient of allocation.transfers) {
    if (
      !account(recipient.destinationAccountId) ||
      destinations.has(recipient.destinationAccountId) ||
      !Number.isSafeInteger(recipient.amount) ||
      recipient.amount < 0
    )
      return undefined;
    destinations.add(recipient.destinationAccountId);
    if (recipient.role === "store") {
      if (store !== undefined) return undefined;
      store = recipient.destinationAccountId;
    }
  }
  return store;
}

/** At most two exact-charge allocations; mutable payments never establish original ownership. */
export async function originalRefundSeller(
  ctx: QueryCtx,
  scope: Pick<
    RefundCommandScope,
    "stripeChargeId" | "stripePaymentIntentId" | "currency"
  >,
): Promise<string | undefined> {
  const allocations = await ctx.db
    .query("settlementAllocations")
    .withIndex("by_source_charge", (q) =>
      q.eq("sourceChargeId", scope.stripeChargeId),
    )
    .take(2);
  const allocation = allocations[0];
  if (
    allocations.length !== 1 ||
    !allocation ||
    allocation.paymentIntentId !== scope.stripePaymentIntentId ||
    allocation.currency !== scope.currency
  )
    return undefined;
  return seller(allocation);
}
