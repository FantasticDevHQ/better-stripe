import { updateObligation } from "../affiliateRecovery/accounting.js";
import type { Infer } from "convex/values";
import type { Doc } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { commissionExposureValidator } from "./clawbackSchema.js";

export type CommissionExposure = Infer<typeof commissionExposureValidator>;

/** Exact round-half-up proportional commission in integer currency units. */
export function proportionalCommission(
  commission: number,
  principal: number,
  charge: number,
): number {
  for (const n of [commission, principal, charge]) {
    if (!Number.isSafeInteger(n) || n < 0)
      throw new Error(
        "Commission recovery requires non-negative integer units.",
      );
  }
  if (charge === 0)
    throw new Error("Commission recovery requires a positive charge.");
  const numerator = BigInt(commission) * BigInt(Math.min(principal, charge));
  return Number((2n * numerator + BigInt(charge)) / (2n * BigInt(charge)));
}

/** Lazily migrate one immutable original affiliate leg, also used by backfill. */
export async function ensureCommissionObligation(
  ctx: MutationCtx,
  transfer: Doc<"transfers">,
  chargeAmount: number,
) {
  if (
    transfer.role !== "affiliate" ||
    transfer.reinstatement ||
    !transfer.sourceChargeId
  )
    throw new Error(
      "Commission obligation requires an original affiliate transfer.",
    );
  const existing = await ctx.db
    .query("affiliateObligations")
    .withIndex("by_transfer", (q) =>
      q.eq("stripeTransferId", transfer.stripeTransferId),
    )
    .unique();
  if (existing) {
    if (
      existing.chargeAmount !== chargeAmount ||
      (existing.releasedCommission ?? existing.originalCommission) !==
        transfer.amount ||
      existing.affiliateAccountId !== transfer.destinationAccountId ||
      existing.currency !== transfer.currency ||
      existing.sourceChargeId !== transfer.sourceChargeId ||
      (transfer.sourceInvoiceId !== undefined &&
        existing.sourceInvoiceId !== transfer.sourceInvoiceId)
    )
      throw new Error("Original affiliate commission identity cannot change.");
    return existing;
  }
  proportionalCommission(transfer.amount, 0, chargeAmount);
  const allocation = await ctx.db
    .query("settlementAllocations")
    .withIndex("by_source_charge", (q) =>
      q.eq("sourceChargeId", transfer.sourceChargeId!),
    )
    .unique();
  const earning = await ctx.db
    .query("affiliateEarnings")
    .withIndex("by_charge_affiliate", (q) =>
      q
        .eq("sourceChargeId", transfer.sourceChargeId!)
        .eq("affiliateAccountId", transfer.destinationAccountId),
    )
    .unique();
  if (
    allocation &&
    (allocation.gross !== chargeAmount ||
      allocation.currency !== transfer.currency ||
      !allocation.transfers.some(
        (leg) =>
          leg.role === "affiliate" &&
          leg.destinationAccountId === transfer.destinationAccountId &&
          leg.amount === (earning?.originalCommission ?? transfer.amount),
      ))
  )
    throw new Error("Commission recovery conflicts with original settlement.");
  const recoveredAmount = transfer.reversedAmount ?? 0;
  if (
    !Number.isSafeInteger(recoveredAmount) ||
    recoveredAmount < 0 ||
    recoveredAmount > transfer.amount
  )
    throw new Error("Invalid original affiliate reversal balance.");
  const id = await ctx.db.insert("affiliateObligations", {
    stripeTransferId: transfer.stripeTransferId,
    sourceChargeId: transfer.sourceChargeId,
    sourceInvoiceId: transfer.sourceInvoiceId ?? allocation?.sourceInvoiceId,
    paymentIntentId: allocation?.paymentIntentId,
    paymentId: transfer.paymentId ?? allocation?.paymentId,
    storeAccountId: allocation?.transfers.find((leg) => leg.role === "store")
      ?.destinationAccountId,
    affiliateAccountId: transfer.destinationAccountId,
    currency: transfer.currency,
    chargeAmount,
    originalCommission: earning?.originalCommission ?? transfer.amount,
    releasedCommission: transfer.amount,
    earningId: earning?._id,
    refundedPrincipal: 0,
    disputedPrincipal: 0,
    lostPrincipal: 0,
    finalizedAmount: 0,
    provisionalAmount: 0,
    recoveredAmount,
    needsReconciliation:
      recoveredAmount > 0 || (transfer.reversalClaimedAmount ?? 0) > 0,
  });
  return (await ctx.db.get("affiliateObligations", id))!;
}

/** Refunds and disputes share the same original-principal exposure axis. */
export async function applyCommissionExposure(
  ctx: MutationCtx,
  transfer: Doc<"transfers">,
  exposure: CommissionExposure,
) {
  proportionalCommission(
    transfer.amount,
    exposure.principal,
    exposure.chargeAmount,
  );
  if (exposure.kind === "refund" && !exposure.finalized)
    throw new Error("Pending refunds cannot create commission obligations.");
  const row = await ensureCommissionObligation(
    ctx,
    transfer,
    exposure.chargeAmount,
  );
  return applyObligationExposure(ctx, row, exposure);
}
export async function applyObligationExposure(
  ctx: MutationCtx,
  row: Doc<"affiliateObligations">,
  exposure: CommissionExposure,
) {
  proportionalCommission(
    row.originalCommission,
    exposure.principal,
    exposure.chargeAmount,
  );
  if (row.chargeAmount !== exposure.chargeAmount)
    throw new Error("Original charge amount cannot change.");
  const principal = Math.min(exposure.principal, exposure.chargeAmount);
  const refundedPrincipal = Math.max(
    row.refundedPrincipal,
    exposure.refundedPrincipal ?? 0,
    exposure.kind === "refund" ? principal : 0,
  );
  let disputedPrincipal = Math.max(
    row.disputedPrincipal,
    exposure.kind === "dispute" ? principal : 0,
  );
  let lostPrincipal = Math.max(
    row.lostPrincipal,
    exposure.kind === "dispute" && exposure.finalized ? principal : 0,
  );
  const incomingState =
    exposure.disputeState ?? (exposure.finalized ? "lost" : "open");
  const rank = { open: 0, lost: 1, won: 2 };
  const disputeState =
    exposure.kind === "dispute" &&
    rank[incomingState] >= rank[row.disputeState ?? "open"]
      ? incomingState
      : row.disputeState;
  if (disputeState === "won") {
    disputedPrincipal = 0;
    lostPrincipal = 0;
  }
  if (exposure.kind === "dispute" && disputeState === "lost")
    lostPrincipal = Math.max(lostPrincipal, disputedPrincipal);
  const finalizedAmount = proportionalCommission(
    row.originalCommission,
    Math.max(refundedPrincipal, lostPrincipal),
    row.chargeAmount,
  );
  const target = proportionalCommission(
    row.originalCommission,
    Math.max(refundedPrincipal, disputedPrincipal),
    row.chargeAmount,
  );
  await updateObligation(ctx, row, {
    disputeState,
    lastRefundId: exposure.refundId ?? row.lastRefundId,
    disputeId: exposure.disputeId ?? row.disputeId,
    refundedPrincipal,
    disputedPrincipal,
    lostPrincipal,
    finalizedAmount,
    provisionalAmount: target - finalizedAmount,
  });
  return target;
}

/** Webhook upserts cannot rewrite a frozen commission or its confirmed balance. */
export async function syncCommissionTransfer(
  ctx: MutationCtx,
  transfer: Doc<"transfers">,
) {
  const row = await ctx.db
    .query("affiliateObligations")
    .withIndex("by_transfer", (q) =>
      q.eq("stripeTransferId", transfer.stripeTransferId),
    )
    .unique();
  if (!row) return;
  await ensureCommissionObligation(ctx, transfer, row.chargeAmount);
  const recoveredAmount = Math.max(
    row.recoveredAmount,
    transfer.reversedAmount ?? 0,
  );
  if (
    !Number.isSafeInteger(recoveredAmount) ||
    recoveredAmount > row.originalCommission
  )
    throw new Error("Invalid confirmed affiliate reversal balance.");
  if (recoveredAmount > row.recoveredAmount && row.activeOperationId) return;
  await updateObligation(ctx, row, {
    recoveredAmount,
    ...(recoveredAmount > row.recoveredAmount && row.accounted
      ? { needsReconciliation: true }
      : {}),
  });
}
