import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import { recoverSettlementTransfers } from "../settlement/reconciliation.js";
import {
  executeClaimedSlices,
  type ReversalClaim,
} from "../connect/reversalExecution.js";
import { reconcileAffiliateCharge } from "./engine.js";

/** Record proportional original commission exposure for a monetary dispute. */
export async function reverseTransfersForDispute(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: {
    sourceChargeId: string;
    operationId: string;
    chargeAmount: number;
    amount: number;
    finalized: boolean;
    disputeState?: "open" | "lost" | "won";
    refundedPrincipal?: number;
  },
) {
  await recoverSettlementTransfers(stripe, component, ctx, opts.sourceChargeId);
  const claim = (await runMutationOrThrow(
    ctx,
    componentRef(component, "connect/mutations/claimReversalSlices"),
    {
      sourceChargeId: opts.sourceChargeId,
      operationId: opts.operationId,
      mode:
        opts.disputeState === "won"
          ? {
              kind: "fraction",
              chargeAmount: opts.chargeAmount,
              amountRefunded: 0,
            }
          : { kind: "amount", amount: opts.amount },
      commissionExposure: {
        kind: "dispute",
        chargeAmount: opts.chargeAmount,
        principal: opts.amount,
        finalized: opts.finalized,
        disputeState: opts.disputeState,
        refundedPrincipal: opts.refundedPrincipal,
        disputeId: opts.operationId,
      },
    },
  )) as ReversalClaim;
  const result = await executeClaimedSlices(
    stripe,
    component,
    ctx,
    opts.operationId,
    { ...claim, slices: claim.slices.filter((s) => !s.commissionTracked) },
  );
  await reconcileAffiliateCharge(stripe, component, ctx, opts.sourceChargeId);
  return result;
}
