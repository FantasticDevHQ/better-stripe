import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import type { RecoveryGroup } from "../costRecovery.js";
import { attachRecoveryInvoice } from "../costRecovery-invoices.js";
import { singleInvoiceFunding } from "../paymentSource/funding.js";
import { saleAmountFailure } from "../paymentSource/economics.js";
import { boundedCostHistory } from "../settlement/processingCostHistory.js";
import {
  getProcessingCostContext,
  type ProcessingCostContext,
} from "../settlement/processingCosts.js";
import { processingCostOutcome } from "../financialOutcomes/adapters.js";
import type { FinancialOutcome } from "../financialOutcomes/contracts.js";
import type {
  ProcessingCostObservation,
  ProcessingCostSnapshot,
} from "./contracts.js";
const bounds = { maxPages: 5, maxItems: 500 };
const identity = () =>
  ({
    status: "conflict",
    reason: "identity_changed",
    retryable: false,
  }) as const;
const unsupported = () =>
  ({
    status: "rejected",
    reason: "unsupported_source",
    retryable: false,
  }) as const;
const incomplete = () =>
  ({
    status: "unknown",
    reason: "history_incomplete",
    retryable: false,
  }) as const;
const id = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : value?.id;
const integer = (n: unknown) =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
type VerifiedFunding = {
  cost: Extract<ProcessingCostContext, { status: "ready" }>;
  provenance: ProcessingCostObservation["provenance"];
};
function validRow(row: Stripe.InvoicePayment, invoice: Stripe.Invoice) {
  return (
    row.object === "invoice_payment" &&
    ["paid", "open", "canceled"].includes(row.status) &&
    row.currency === invoice.currency &&
    row.livemode === invoice.livemode &&
    !!id(row.invoice) &&
    !!row.payment &&
    typeof row.payment.type === "string"
  );
}
/** A collected recovery item has funding provenance, not an invented original price. All provider IO is read-only. */
export async function readCollectedInvoiceFunding(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  op: ProcessingCostSnapshot,
): Promise<FinancialOutcome<VerifiedFunding>> {
  if (
    op.source.kind !== "invoice_recovery" ||
    !op.rollback ||
    op.rollback.groupKey !== op.source.groupKey
  )
    return identity();
  const group = (await ctx.runQuery(
    componentRef(component, "costRecovery/queries/group"),
    { groupKey: op.source.groupKey },
  )) as RecoveryGroup | null;
  if (
    !group ||
    group.accountId !== op.accountId ||
    group.scopeKey !== op.scopeKey ||
    group.currency !== op.currency ||
    group.sourceKind !== "invoice" ||
    !group.invoiceItemId
  )
    return identity();
  if (group.status !== "collected")
    return { status: "not_ready", reason: "provider_pending", retryable: true };
  const invoice = await stripe.invoices.retrieve(group.sourceId);
  if (
    invoice.object !== "invoice" ||
    invoice.id !== group.sourceId ||
    invoice.customer_account !== group.accountId ||
    typeof invoice.livemode !== "boolean"
  )
    return identity();
  if (invoice.currency !== op.currency)
    return {
      status: "rejected",
      reason: "currency_mismatch",
      retryable: false,
    };
  if (
    invoice.status !== "paid" ||
    ![invoice.amount_paid, invoice.amount_due, invoice.total].every(
      (n) => integer(n) && n === op.source.gross,
    ) ||
    invoice.amount_remaining !== 0 ||
    invoice.amount_overpaid !== 0
  )
    return unsupported();
  await attachRecoveryInvoice(
    stripe,
    group,
    {
      accountId: op.accountId,
      scopeKey: op.scopeKey,
      currency: op.currency,
      groupKey: group.groupKey,
    },
    async () => {
      throw new Error("Collected recovery item must already be bound.");
    },
    false,
    500,
    bounds,
  );
  const forward = await boundedCostHistory(
    (cursor, limit) =>
      stripe.invoicePayments.list({
        invoice: invoice.id,
        limit,
        ...(cursor ? { starting_after: cursor } : {}),
      }),
    bounds,
  );
  if (forward.some((row) => !validRow(row, invoice))) return incomplete();
  if (forward.some((row) => id(row.invoice) !== invoice.id)) return identity();
  const funded = singleInvoiceFunding(forward, invoice.amount_paid);
  if (
    !funded ||
    !integer(funded.amount_paid) ||
    funded.amount_requested !== op.source.gross
  )
    return unsupported();
  if (id(funded.payment.payment_intent) !== op.source.paymentIntentId)
    return identity();
  const paymentIntentId = op.source.paymentIntentId;
  const inverse = await boundedCostHistory(
    (cursor, limit) =>
      stripe.invoicePayments.list({
        payment: { type: "payment_intent", payment_intent: paymentIntentId },
        limit,
        ...(cursor ? { starting_after: cursor } : {}),
      }),
    bounds,
  );
  if (inverse.some((row) => !validRow(row, invoice))) return incomplete();
  if (
    inverse.some(
      (row) =>
        row.payment.type !== "payment_intent" ||
        id(row.payment.payment_intent) !== paymentIntentId,
    )
  )
    return identity();
  const unique = singleInvoiceFunding(inverse, op.source.gross);
  if (!unique || unique.amount_requested !== op.source.gross)
    return unsupported();
  if (unique.id !== funded.id || id(unique.invoice) !== invoice.id)
    return identity();
  const payment = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ["latest_charge.balance_transaction"],
  });
  if (
    payment.object !== "payment_intent" ||
    payment.id !== paymentIntentId ||
    payment.customer_account !== group.accountId ||
    payment.livemode !== invoice.livemode
  )
    return identity();
  if (payment.status === "processing")
    return { status: "not_ready", reason: "provider_pending", retryable: true };
  if (payment.status !== "succeeded")
    return {
      status: "rejected",
      reason: "payment_not_payable",
      retryable: false,
    };
  if (
    payment.amount !== op.source.gross ||
    payment.amount_received !== op.source.gross ||
    payment.currency !== op.currency
  )
    return identity();
  const charge = payment.latest_charge;
  if (!charge || typeof charge === "string")
    return { status: "not_ready", reason: "provider_pending", retryable: true };
  if (
    charge.object !== "charge" ||
    !charge.id ||
    id(charge.payment_intent) !== payment.id ||
    charge.livemode !== payment.livemode
  )
    return identity();
  if (
    !charge.paid ||
    !charge.captured ||
    charge.status !== "succeeded" ||
    charge.amount_captured !== op.source.gross
  )
    return unsupported();
  if (!charge.balance_transaction)
    return { status: "not_ready", reason: "fee_pending", retryable: true };
  const balance =
    typeof charge.balance_transaction === "string"
      ? await stripe.balanceTransactions.retrieve(charge.balance_transaction)
      : charge.balance_transaction;
  if (
    (typeof charge.balance_transaction === "string" &&
      balance.id !== charge.balance_transaction) ||
    balance.object !== "balance_transaction" ||
    !balance.id ||
    id(balance.source) !== charge.id
  )
    return identity();
  const invalid = saleAmountFailure(payment, charge, balance);
  if (invalid === "currency")
    return {
      status: "rejected",
      reason: "currency_mismatch",
      retryable: false,
    };
  if (
    invalid ||
    !integer(balance.amount) ||
    !integer(balance.net) ||
    balance.amount !== op.source.gross ||
    balance.amount - balance.fee !== balance.net
  )
    return unsupported();
  const cost = await getProcessingCostContext(stripe, {
    paymentIntentId,
    historyBounds: bounds,
  });
  if (cost.status !== "ready") return processingCostOutcome(cost);
  if (
    cost.paymentIntentId !== payment.id ||
    cost.chargeId !== charge.id ||
    cost.gross !== op.source.gross ||
    cost.currency !== op.currency ||
    cost.processingFee !== balance.fee
  )
    return identity();
  if (
    group.invoiceFunding &&
    (group.invoiceFunding.sourceChargeId !== cost.chargeId ||
      group.invoiceFunding.sourceGross !== cost.gross ||
      group.invoiceFunding.sourceProcessingFee !== cost.processingFee)
  )
    return identity();
  return {
    status: "ready",
    value: {
      cost,
      provenance: {
        invoiceId: invoice.id,
        invoicePaymentId: funded.id,
        customerAccountId: group.accountId,
        recoveryInvoiceItemId: group.invoiceItemId,
      },
    },
  };
}
