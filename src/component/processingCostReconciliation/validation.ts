import type { Infer } from "convex/values";
import type { Doc } from "../_generated/dataModel.js";
import { observation } from "./schema.js";
import { same } from "../recoveryWorkflow/helpers.js";
import { conflict } from "./helpers.js";
const identifier = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 200;
export function observationFailure(
  op: Doc<"processingCostReconciliationOperations">,
  o: Infer<typeof observation>,
  original: Doc<"processingCostReconciliationOperations"> | null,
) {
  if (
    [
      o.gross,
      o.originalProcessingFee,
      o.processingFee,
      o.disputeFees,
      o.principalReturned,
    ].some((n) => !Number.isSafeInteger(n) || n < 0) ||
    o.gross === 0 ||
    o.principalReturned > o.gross ||
    !identifier(o.sourceChargeId) ||
    !identifier(o.provenance.invoiceId) ||
    !identifier(o.provenance.invoicePaymentId) ||
    !identifier(o.provenance.customerAccountId)
  )
    return {
      status: "rejected",
      reason: "unsupported_source",
      retryable: false,
    } as const;
  if (
    o.paymentIntentId !== op.source.paymentIntentId ||
    o.gross !== op.source.gross ||
    o.currency !== op.currency
  )
    return conflict("identity_changed");
  if (op.source.kind === "sale") {
    if (o.provenance.recoveryInvoiceItemId !== undefined)
      return conflict("identity_changed");
    if (
      !identifier(o.provenance.stripePriceId) ||
      !identifier(o.provenance.stripeProductId)
    )
      return {
        status: "rejected",
        reason: "unsupported_source",
        retryable: false,
      } as const;
    if (
      o.provenance.customerAccountId !== op.source.customerAccountId ||
      (op.source.invoiceId !== undefined &&
        o.provenance.invoiceId !== op.source.invoiceId) ||
      (op.source.subscriptionId !== undefined &&
        o.provenance.subscriptionId !== op.source.subscriptionId) ||
      (op.source.stripePriceId !== undefined &&
        o.provenance.stripePriceId !== op.source.stripePriceId) ||
      (op.source.stripeProductId !== undefined &&
        o.provenance.stripeProductId !== op.source.stripeProductId)
    )
      return conflict("identity_changed");
  } else if (
    o.provenance.stripePriceId !== undefined ||
    o.provenance.stripeProductId !== undefined
  )
    return conflict("identity_changed");
  if (
    original &&
    (original.policy.sellingFee !== op.policy.sellingFee ||
      original.source.kind !== op.source.kind ||
      (original.source.kind === "sale" &&
        op.source.kind === "sale" &&
        original.source.stripeAccountId !== op.source.stripeAccountId) ||
      !same(original.result?.observation.provenance, o.provenance))
  )
    return conflict("identity_changed");
  return null;
}
