import { v } from "convex/values";
import type { PayoutFundingSource, RecipientPayoutPlan } from "./allocation.js";
import { add } from "./helpers.js";
export const progressAccounting = v.object({
  carriedForwardAmount: v.number(),
  withheldAmount: v.number(),
  reservedAmount: v.number(),
  releasedAmount: v.number(),
});
/** Inputs have passed allocation validation. Shared costs are never attributed to a source category. */
export function summarizePayoutProgress(
  plan: RecipientPayoutPlan,
  funding: PayoutFundingSource[],
  costs: number,
) {
  const sources = (["store", "affiliate", "other"] as const).map((role) => {
    let matureUnpaid = 0,
      pendingCredits = 0,
      releasedAmount = 0,
      reservedAmount = 0;
    for (const source of funding)
      if (
        source.currency === plan.currency &&
        (source.role ?? "other") === role
      ) {
        matureUnpaid = add(
          matureUnpaid,
          add(
            add(source.matureNet, -source.paidAmount),
            -source.reservedAmount,
          ),
        );
        pendingCredits = add(pendingCredits, source.pendingCredits);
        releasedAmount = add(releasedAmount, source.paidAmount);
        reservedAmount = add(reservedAmount, source.reservedAmount);
      }
    return {
      role,
      matureUnpaid,
      pendingCredits,
      releasedAmount,
      reservedAmount,
    };
  });
  const total = (field: "matureUnpaid" | "releasedAmount" | "reservedAmount") =>
    sources.reduce((sum, source) => add(sum, source[field]), 0);
  return {
    sources,
    accounting: {
      carriedForwardAmount: Math.max(0, add(plan.matureUnpaid, -plan.amount)),
      withheldAmount: Math.min(Math.max(0, total("matureUnpaid")), costs),
      reservedAmount: total("reservedAmount"),
      releasedAmount: total("releasedAmount"),
    },
  };
}
