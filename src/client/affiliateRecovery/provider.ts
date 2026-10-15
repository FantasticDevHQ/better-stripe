import type Stripe from "stripe";
import type { Doc } from "../../component/_generated/dataModel.js";
export type RecoveryOperation = Doc<"affiliateRecoveryOperations">;
export type RecoveryObligation = Doc<"affiliateObligations">;
export async function findReceipt(
  stripe: Stripe,
  op: RecoveryOperation,
  row: RecoveryObligation,
) {
  let count = 0;
  if (op.kind === "recovery") {
    if (!row.stripeTransferId) return null;
    for await (const receipt of stripe.transfers.listReversals(
      row.stripeTransferId,
      { limit: 100 },
    )) {
      if (++count > 1000)
        throw new Error("Affiliate receipt history exceeds supported bound.");
      if (receipt.metadata?.bsRecoveryOperation !== op._id) continue;
      if (receipt.amount !== op.amount)
        throw new Error("Affiliate reversal receipt amount mismatch.");
      return receipt.id;
    }
  } else {
    for await (const receipt of stripe.transfers.list({
      transfer_group: `bs_restore_${row._id}`,
      limit: 100,
    })) {
      if (++count > 1000)
        throw new Error(
          "Affiliate restoration history exceeds supported bound.",
        );
      if (receipt.metadata?.bsRecoveryOperation !== op._id) continue;
      const destination =
        typeof receipt.destination === "string"
          ? receipt.destination
          : receipt.destination?.id;
      if (
        receipt.amount !== op.amount ||
        receipt.currency !== row.currency ||
        destination !== row.affiliateAccountId
      )
        throw new Error("Affiliate restoration receipt identity mismatch.");
      return receipt.id;
    }
  }
  return null;
}
export async function verifyConnectPath(
  stripe: Stripe,
  row: RecoveryObligation,
  kind: RecoveryOperation["kind"],
) {
  const account = await stripe.v2.core.accounts.retrieve(
    row.affiliateAccountId,
    { include: ["configuration.recipient"] },
  );
  const capability =
    account.configuration?.recipient?.capabilities?.stripe_balance
      ?.stripe_transfers;
  if (capability?.status !== "active")
    return {
      supported: false,
      reason:
        "Connect recipient stripe_transfers capability is not active; operator review required.",
    };
  if (kind === "recovery") {
    if (!row.stripeTransferId)
      return {
        supported: false,
        reason:
          "No original Connect transfer; recover through future commissions.",
      };
    const original = await stripe.transfers.retrieve(row.stripeTransferId);
    const destination =
      typeof original.destination === "string"
        ? original.destination
        : original.destination?.id;
    if (
      destination !== row.affiliateAccountId ||
      original.currency !== row.currency ||
      original.source_transaction !== row.sourceChargeId ||
      original.amount !== (row.releasedCommission ?? row.originalCommission)
    )
      return {
        supported: false,
        reason:
          "Original Connect transfer identity does not match the commission; operator review required.",
      };
  }
  return {
    supported: true,
    reason:
      "Original Connect path verified; reversal remains subject to available balance and provider restrictions.",
  };
}
export function classifyRecoveryError(error: unknown): {
  state: "unknown" | "insufficient_balance" | "unsupported" | "failed";
  error: string;
} {
  const value = error as { code?: string; type?: string; message?: string };
  const code = value.code ?? "";
  const state = ["balance_insufficient", "insufficient_funds"].includes(code)
    ? "insufficient_balance"
    : [
          "account_invalid",
          "transfers_not_allowed",
          "resource_missing",
          "platform_account_required",
        ].includes(code)
      ? "unsupported"
      : [
            "StripeConnectionError",
            "StripeAPIError",
            "StripeRateLimitError",
          ].includes(value.type ?? "") ||
          code === "idempotency_key_in_use" ||
          !value.type
        ? "unknown"
        : "failed";
  return {
    state,
    error: (
      value.message ?? "Affiliate provider outcome requires reconciliation."
    ).slice(0, 500),
  };
}
