import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import {
  matchingTransfer,
  sourceTransfers,
  recordSettlementTransfer,
} from "../settlement/reconciliation.js";
import type { ResolvedSettlement } from "../settlement/execution.js";
/** Read-only provider recovery: missing legs never create a second money attempt. */
export async function reconcileRecoverySettlement(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  claim: ResolvedSettlement,
): Promise<boolean> {
  const effective = [];
  for (const leg of claim.transfers) {
    const earning =
      leg.role === "affiliate" && leg.amount > 0
        ? ((await ctx.runQuery(
            componentRef(component, "affiliateRecovery/queries/getEarning"),
            {
              sourceChargeId: claim.sourceChargeId,
              affiliateAccountId: leg.destinationAccountId,
            },
          )) as { _id: string; releaseAmount: number } | null)
        : null;
    if (leg.role === "affiliate" && leg.amount > 0 && !earning) return false;
    effective.push({
      leg: { ...leg, amount: earning?.releaseAmount ?? leg.amount },
      earning,
    });
  }
  let provider = await sourceTransfers(stripe, claim.sourceChargeId);
  if (
    effective.some(
      ({ leg }) => leg.amount > 0 && !matchingTransfer(provider, claim, leg),
    )
  )
    provider = [
      ...new Map(
        [
          ...provider,
          ...(await sourceTransfers(stripe, claim.sourceChargeId, true)),
        ].map((t) => [t.id, t]),
      ).values(),
    ];
  for (const { leg, earning } of effective) {
    const transfer =
      leg.amount > 0 ? matchingTransfer(provider, claim, leg) : undefined;
    if (leg.amount > 0 && !transfer) return false;
    if (transfer)
      await recordSettlementTransfer(component, ctx, claim, leg, transfer);
    if (earning)
      await runMutationOrThrow(
        ctx,
        componentRef(component, "affiliateEarnings/mutations/confirmEarning"),
        {
          earningId: earning._id,
          ...(transfer ? { stripeTransferId: transfer.id } : {}),
        },
      );
  }
  return true;
}
