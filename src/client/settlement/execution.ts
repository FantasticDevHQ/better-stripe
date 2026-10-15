import { reconcileAffiliateCharge } from "../affiliateRecovery/engine.js";
import {
  sourceTransfers,
  matchingTransfer,
  recordSettlementTransfer,
} from "./reconciliation.js";
import type Stripe from "stripe";
import type { SplitTransfer } from "../core/fees.js";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
export type ResolvedSettlement = {
  sourceChargeId: string;
  paymentIntentId?: string;
  sourceInvoiceId?: string;
  gross: number;
  currency: string;
  processingFee: number;
  platformNet: number;
  adjustmentAmount?: number;
  transfers: SplitTransfer[];
  paymentId?: string;
};
export type SettlementResult = ResolvedSettlement & {
  status: "settled";
  executedTransfers: {
    stripeTransferId: string;
    destinationAccountId: string;
    role: string;
    amount: number;
  }[];
};
type Ledger = {
  stripeTransferId: string;
  destinationAccountId: string;
  role?: string;
  amount: number;
  currency: string;
};
/** Shared transfer engine for webhook splits and verified, host-resolved allocations. */
export async function executeResolvedTransfers(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: ResolvedSettlement,
): Promise<SettlementResult> {
  const saved = (await runMutationOrThrow(
    ctx,
    componentRef(component, "settlement/mutations/reserveSettlementAllocation"),
    opts,
  )) as ResolvedSettlement;
  const claim: ResolvedSettlement = {
    sourceChargeId: saved.sourceChargeId,
    paymentIntentId: saved.paymentIntentId,
    sourceInvoiceId: saved.sourceInvoiceId,
    gross: saved.gross,
    currency: saved.currency,
    processingFee: saved.processingFee,
    platformNet: saved.platformNet,
    adjustmentAmount: saved.adjustmentAmount,
    transfers: saved.transfers,
    paymentId: saved.paymentId,
  };
  const earnings = new Map<string, { _id: string; releaseAmount: number }>();
  for (const leg of claim.transfers)
    if (leg.role === "affiliate" && leg.amount > 0) {
      const earning = (await runMutationOrThrow(
        ctx,
        componentRef(component, "affiliateEarnings/mutations/reserveEarning"),
        {
          sourceChargeId: claim.sourceChargeId,
          affiliateAccountId: leg.destinationAccountId,
        },
      )) as { _id: string; releaseAmount: number } | undefined;
      if (earning?._id) earnings.set(leg.destinationAccountId, earning);
    }
  const effective = claim.transfers.map((leg) =>
    leg.role === "affiliate" && earnings.has(leg.destinationAccountId)
      ? {
          ...leg,
          amount: earnings.get(leg.destinationAccountId)!.releaseAmount,
        }
      : leg,
  );
  const existing = ((await ctx.runQuery(
    componentRef(component, "connect/queries/listTransfersByCharge"),
    { sourceChargeId: claim.sourceChargeId },
  )) ?? []) as Ledger[];
  let provider = await sourceTransfers(stripe, claim.sourceChargeId);
  if (
    effective.some(
      (leg) =>
        leg.amount > 0 &&
        !existing.some(
          (t) =>
            t.destinationAccountId === leg.destinationAccountId &&
            t.role === leg.role,
        ) &&
        !matchingTransfer(provider, claim, leg),
    )
  ) {
    provider = [
      ...new Map(
        [
          ...provider,
          ...(await sourceTransfers(stripe, claim.sourceChargeId, true)),
        ].map((t) => [t.id, t]),
      ).values(),
    ];
  }
  const executedTransfers: SettlementResult["executedTransfers"] = [];
  for (const leg of effective) {
    const earning =
      leg.role === "affiliate"
        ? earnings.get(leg.destinationAccountId)
        : undefined;
    if (leg.amount === 0) {
      if (earning)
        await runMutationOrThrow(
          ctx,
          componentRef(component, "affiliateEarnings/mutations/confirmEarning"),
          { earningId: earning._id },
        );
      continue;
    }
    const recorded = existing.find(
      (t) =>
        t.destinationAccountId === leg.destinationAccountId &&
        t.role === leg.role,
    );
    if (
      recorded &&
      (recorded.amount !== leg.amount || recorded.currency !== claim.currency)
    )
      throw new Error("Recorded transfer conflicts with immutable settlement.");
    let transferId = recorded?.stripeTransferId;
    if (!transferId) {
      const recovered = matchingTransfer(provider, claim, leg);
      const transfer =
        recovered ??
        (await stripe.transfers.create(
          {
            amount: leg.amount,
            currency: claim.currency,
            destination: leg.destinationAccountId,
            source_transaction: claim.sourceChargeId,
            transfer_group: claim.sourceChargeId,
            metadata: {
              bsRole: leg.role,
              bsSourceCharge: claim.sourceChargeId,
            },
          },
          {
            idempotencyKey: `bs_split_${claim.sourceChargeId}_${leg.destinationAccountId}_${leg.role}`,
          },
        ));
      transferId = transfer.id;
      await recordSettlementTransfer(component, ctx, claim, leg, transfer);
    }
    if (earning)
      await runMutationOrThrow(
        ctx,
        componentRef(component, "affiliateEarnings/mutations/confirmEarning"),
        { earningId: earning._id, stripeTransferId: transferId },
      );
    executedTransfers.push({
      stripeTransferId: transferId,
      destinationAccountId: leg.destinationAccountId,
      role: leg.role,
      amount: leg.amount,
    });
  }
  if (earnings.size)
    await reconcileAffiliateCharge(
      stripe,
      component,
      ctx,
      claim.sourceChargeId,
    );
  return { ...claim, status: "settled", executedTransfers };
}
