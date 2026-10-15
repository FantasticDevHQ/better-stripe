import type Stripe from "stripe";
import type { RecoveryObligation } from "./provider.js";
import { successfulRefundPrincipal } from "../connect/refundPrincipal.js";
/** Operator-selected provenance is verified against exact provider receipts. */
export async function verifiedLegacyReview(
  stripe: Stripe,
  row: RecoveryObligation,
  opts: {
    reversalIds: string[];
    restorationTransferIds?: string[];
    note: string;
  },
) {
  if (
    !opts.note.trim() ||
    opts.reversalIds.length > 100 ||
    new Set(opts.reversalIds).size !== opts.reversalIds.length ||
    (opts.restorationTransferIds?.length ?? 0) > 100
  )
    throw new Error("Provide a review note and at most 100 unique receipts.");
  if (!row.stripeTransferId)
    throw new Error("Legacy review requires an original Connect transfer.");
  const original = await stripe.transfers.retrieve(row.stripeTransferId);
  const destination =
    typeof original.destination === "string"
      ? original.destination
      : original.destination?.id;
  if (
    destination !== row.affiliateAccountId ||
    original.currency !== row.currency ||
    original.source_transaction !== row.sourceChargeId
  )
    throw new Error("Legacy transfer identity mismatch.");
  const receipts = [];
  for (const id of opts.reversalIds) {
    const receipt = await stripe.transfers.retrieveReversal(
      row.stripeTransferId,
      id,
    );
    if (
      receipt.transfer !== row.stripeTransferId ||
      receipt.currency !== row.currency ||
      receipt.id !== id
    )
      throw new Error("Legacy reversal receipt identity mismatch.");
    receipts.push({ id, amount: receipt.amount });
  }
  const recoveredAmount = receipts.reduce((sum, r) => sum + r.amount, 0);
  if (recoveredAmount > original.amount_reversed)
    throw new Error("Legacy receipts exceed confirmed provider reversals.");
  let restoredAmount = 0;
  const restorationIds = opts.restorationTransferIds ?? [];
  if (new Set(restorationIds).size !== restorationIds.length)
    throw new Error("Restoration receipts must be unique.");
  for (const id of restorationIds) {
    const transfer = await stripe.transfers.retrieve(id);
    const recipient =
      typeof transfer.destination === "string"
        ? transfer.destination
        : transfer.destination?.id;
    if (
      recipient !== row.affiliateAccountId ||
      transfer.currency !== row.currency ||
      transfer.metadata.bsReinstateOf !== row.sourceChargeId
    )
      throw new Error("Legacy restoration receipt identity mismatch.");
    restoredAmount += transfer.amount;
  }
  const charge = await stripe.charges.retrieve(row.sourceChargeId);
  const refundedPrincipal = await successfulRefundPrincipal(
    stripe,
    row.sourceChargeId,
  );
  const disputes = [];
  for await (const dispute of stripe.disputes.list({
    charge: row.sourceChargeId,
    limit: 100,
  })) {
    if (disputes.length >= 10)
      throw new Error(
        "Legacy dispute history requires manual source allocation.",
      );
    if (
      !dispute.status.startsWith("warning_") &&
      dispute.status !== "prevented"
    )
      disputes.push(dispute);
  }
  if (disputes.length > 1)
    throw new Error(
      "Multiple monetary disputes require manual source allocation.",
    );
  const dispute = disputes[0];
  return {
    obligationId: row._id,
    recoveredAmount,
    restoredAmount,
    receipts,
    restorationIds,
    note: opts.note,
    exposure: {
      kind: dispute ? ("dispute" as const) : ("refund" as const),
      chargeAmount: charge.amount,
      principal: dispute?.amount ?? refundedPrincipal,
      finalized: dispute ? dispute.status === "lost" : true,
      refundedPrincipal,
      disputeId: dispute?.id,
      disputeState: dispute
        ? dispute.status === "won"
          ? ("won" as const)
          : dispute.status === "lost"
            ? ("lost" as const)
            : ("open" as const)
        : undefined,
    },
  };
}
