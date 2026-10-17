import type { VerifiedSale } from "../settlement/verifiedSale.js";
import type { ProcessingCostContext } from "../settlement/processingCosts.js";
import type { FinancialUnavailable, FinancialOutcome } from "./contracts.js";

/** Additive adapter; the existing getVerifiedSale result remains unchanged. */
export function verifiedSaleOutcome(
  sale: Exclude<VerifiedSale, { status: "ready" }>,
): FinancialUnavailable;
export function verifiedSaleOutcome(
  sale: VerifiedSale,
): FinancialOutcome<Extract<VerifiedSale, { status: "ready" }>>;
export function verifiedSaleOutcome(
  sale: VerifiedSale,
): FinancialOutcome<Extract<VerifiedSale, { status: "ready" }>> {
  if (sale.status === "ready") return { status: "ready", value: sale };
  if (
    sale.status === "not_payable" &&
    ["payment_not_succeeded", "charge_refunded_or_disputed"].includes(
      sale.reason,
    )
  )
    return {
      status: "rejected",
      reason: "payment_not_payable",
      retryable: false,
    };
  if (sale.status === "pending" && sale.retryable) {
    if (sale.reason === "processing_fee_unavailable")
      return { status: "not_ready", reason: "fee_pending", retryable: true };
    if (
      ["payment_processing", "charge_unavailable", "invoice_not_paid"].includes(
        sale.reason,
      )
    )
      return {
        status: "not_ready",
        reason: "provider_pending",
        retryable: true,
      };
  }
  return { status: "rejected", reason: "unsupported_source", retryable: false };
}

/** Missing fees never become zero; a currency mismatch is terminal. */
export function processingCostOutcome(
  cost: Extract<ProcessingCostContext, { status: "not_ready" }>,
): FinancialUnavailable;
export function processingCostOutcome(
  cost: ProcessingCostContext,
): FinancialOutcome<Extract<ProcessingCostContext, { status: "ready" }>>;
export function processingCostOutcome(
  cost: ProcessingCostContext,
): FinancialOutcome<Extract<ProcessingCostContext, { status: "ready" }>> {
  if (cost.status === "ready") return { status: "ready", value: cost };
  switch (cost.reason) {
    case "payment_not_succeeded":
      return {
        status: "rejected",
        reason: "payment_not_payable",
        retryable: false,
      };
    case "currency_mismatch":
      return {
        status: "rejected",
        reason: "currency_mismatch",
        retryable: false,
      };
    case "charge_unavailable":
    case "refund_pending":
      return {
        status: "not_ready",
        reason: "provider_pending",
        retryable: true,
      };
    case "charge_transaction_unavailable":
    case "refund_transaction_unavailable":
    case "refund_failure_transaction_unavailable":
    case "dispute_transactions_unavailable":
    case "dispute_reinstatement_unavailable":
      return { status: "not_ready", reason: "fee_pending", retryable: true };
    default:
      return {
        status: "rejected",
        reason: "unsupported_source",
        retryable: false,
      };
  }
}
