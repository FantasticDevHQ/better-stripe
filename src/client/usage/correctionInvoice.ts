import Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import type { Doc } from "../../component/_generated/dataModel.js";
import type { PreparedUsageRecord } from "./records.js";
import type { UsageDeliveryProviderOptions } from "./deliveryProvider.js";
import type { StripeApiVersion } from "../stripe-types.js";
import { verifyRealm } from "./catalogTypes.js";
import { subscriptionSnapshot } from "../../component/usage/helpers.js";
import {
  invoiceCorrectionOptions,
  correctionView,
  type UsageInvoiceCorrectionOptions,
} from "./correctionTerms.js";
import { invoiceCorrectionProof } from "./correctionInvoiceProof.js";
import {
  referenceId,
  paymentReference,
} from "../billing/invoicePaymentShared.js";
const requireProof = (valid: unknown) => {
  if (!valid)
    throw new Error("Native invoice correction requires reconciliation");
};
/** Read-only provider adoption. The operator creates notes/refunds through existing authorized billing workflows. */
export async function observeInvoiceCorrection(
  component: Component,
  ctx: RunCtx,
  input: UsageInvoiceCorrectionOptions,
  options: UsageDeliveryProviderOptions,
) {
  const opts = invoiceCorrectionOptions.parse(input);
  const row = (await ctx.runQuery(
    componentRef(component, "usageCorrections/queries/get"),
    {
      scope: opts.scope,
      eventId: opts.eventId,
      correctionId: opts.correctionId,
    },
  )) as Doc<"usageCorrections"> | null;
  if (!row) throw new Error("Usage correction unavailable");
  if (row.adjustmentJson) {
    const pinned = invoiceCorrectionProof.parse(JSON.parse(row.adjustmentJson));
    if (
      pinned.creditNoteId !== opts.creditNoteId ||
      pinned.invoiceId !== opts.invoiceId ||
      pinned.amount !== opts.amount
    )
      throw new Error("Invoice adjustment replay conflict");
  }
  const record = JSON.parse(row.recordJson) as PreparedUsageRecord,
    sub = subscriptionSnapshot(row.subscriptionJson);
  if (!options.stripeSecretKey || record.binding.plan.model === "prepaid")
    return {
      status: "held" as const,
      reason:
        record.binding.plan.model === "prepaid"
          ? "prepaid_credit_reconciliation_required"
          : "provider_unavailable",
    };
  const stripe = new Stripe(options.stripeSecretKey, {
    apiVersion: record.binding.apiVersion as StripeApiVersion,
    maxNetworkRetries: 0,
    timeout: 15000,
    ...(options.httpClient ? { httpClient: options.httpClient } : {}),
  });
  let proof: ReturnType<typeof invoiceCorrectionProof.parse>;
  try {
    await verifyRealm(stripe, {
      stripeAccountId: record.scope.stripeAccountId,
      livemode: record.scope.livemode,
    });
    const [note, invoice, customer] = await Promise.all([
      stripe.creditNotes.retrieve(opts.creditNoteId),
      stripe.invoices.retrieve(opts.invoiceId),
      stripe.customers.retrieve(record.scope.customerAccount),
    ]);
    requireProof(
      !customer.deleted &&
        customer.id === record.binding.stripeCustomerId &&
        customer.customer_account === record.scope.customerAccount &&
        customer.livemode === record.scope.livemode,
    );
    requireProof(
      note.id === opts.creditNoteId &&
        note.object === "credit_note" &&
        note.livemode === record.scope.livemode &&
        note.customer_account === record.scope.customerAccount &&
        referenceId(note.customer) === record.binding.stripeCustomerId &&
        referenceId(note.invoice) === opts.invoiceId &&
        (note.status === "issued" ||
          (note.status === "void" &&
            row.adjustmentJson &&
            note.pre_payment_amount === note.amount &&
            note.post_payment_amount === 0)) &&
        note.currency === record.binding.plan.rate.currency &&
        note.amount === opts.amount &&
        note.total === note.amount &&
        note.subtotal === note.amount &&
        note.discount_amount === 0 &&
        note.amount_shipping === 0 &&
        Array.isArray(note.total_taxes) &&
        note.total_taxes.length === 0 &&
        note.customer_balance_transaction === null &&
        (note.out_of_band_amount === null || note.out_of_band_amount === 0) &&
        Array.isArray(note.pretax_credit_amounts) &&
        note.pretax_credit_amounts.length === 0 &&
        note.lines.has_more === false &&
        note.lines.data.length === 1 &&
        note.amount === note.pre_payment_amount + note.post_payment_amount,
    );
    requireProof(
      invoice.id === opts.invoiceId &&
        invoice.livemode === record.scope.livemode &&
        invoice.customer_account === record.scope.customerAccount &&
        referenceId(invoice.customer) === record.binding.stripeCustomerId &&
        invoice.currency === record.binding.plan.rate.currency &&
        ["open", "paid"].includes(invoice.status ?? "") &&
        referenceId(invoice.parent?.subscription_details?.subscription) ===
          sub.subscriptionId &&
        invoice.lines.has_more === false,
    );
    const noteLine = note.lines.data[0],
      line = invoice.lines.data.find(
        (line) => line.id === noteLine.invoice_line_item,
      );
    requireProof(
      noteLine.type === "invoice_line_item" &&
        noteLine.livemode === record.scope.livemode &&
        noteLine.amount === opts.amount &&
        noteLine.discount_amount === 0 &&
        (noteLine.taxes === null ||
          (Array.isArray(noteLine.taxes) && noteLine.taxes.length === 0)) &&
        Array.isArray(noteLine.pretax_credit_amounts) &&
        noteLine.pretax_credit_amounts.length === 0 &&
        line &&
        line.currency === record.binding.plan.rate.currency &&
        line.amount >= opts.amount &&
        line.pricing?.price_details?.price === record.binding.stripePriceId &&
        line.parent?.subscription_item_details?.subscription_item ===
          sub.subscriptionItemId &&
        !line.parent?.subscription_item_details?.proration &&
        line.period.start === sub.period.start &&
        line.period.end === sub.period.end &&
        Array.isArray(line.pretax_credit_amounts) &&
        line.pretax_credit_amounts.length === 0,
    );
    let paymentIntentId: string | null = null,
      chargeId: string | null = null,
      refundId: string | null = null;
    if (note.post_payment_amount > 0) {
      requireProof(
        note.refunds.length === 1 &&
          note.refunds[0].type === "refund" &&
          note.refunds[0].amount_refunded === note.post_payment_amount,
      );
      refundId = referenceId(note.refunds[0].refund) ?? null;
      requireProof(refundId);
      const refund = await stripe.refunds.retrieve(refundId!);
      paymentIntentId = referenceId(refund.payment_intent) ?? null;
      chargeId = referenceId(refund.charge) ?? null;
      requireProof(
        refund.id === refundId &&
          refund.status === "succeeded" &&
          refund.amount === note.post_payment_amount &&
          refund.currency === note.currency &&
          paymentIntentId &&
          chargeId,
      );
      const [payment, charge, payments] = await Promise.all([
        stripe.paymentIntents.retrieve(paymentIntentId!),
        stripe.charges.retrieve(chargeId!),
        stripe.invoicePayments.list({
          invoice: invoice.id,
          status: "paid",
          limit: 100,
        }),
      ]);
      const references = payments.data.map(paymentReference);
      requireProof(
        payments.has_more === false &&
          references.some(
            ({ invoicePayment: p }) =>
              referenceId(p.invoice) === invoice.id &&
              p.status === "paid" &&
              p.currency === note.currency &&
              p.amount_paid !== null &&
              p.amount_paid >= refund.amount &&
              p.payment.type === "payment_intent" &&
              referenceId(p.payment.payment_intent) === paymentIntentId,
          ),
      );
      requireProof(
        [
          refund.amount,
          payment.amount,
          payment.amount_received,
          charge.amount,
          charge.amount_captured,
          charge.amount_refunded,
        ].every((value) => Number.isSafeInteger(value) && value >= 0),
      );
      requireProof(
        refund.object === "refund" &&
          payment.object === "payment_intent" &&
          charge.object === "charge" &&
          charge.amount_captured === payment.amount_received &&
          charge.amount_captured <= charge.amount &&
          charge.amount_captured <= payment.amount &&
          (!payment.customer ||
            referenceId(payment.customer) ===
              record.binding.stripeCustomerId) &&
          referenceId(charge.customer) === referenceId(payment.customer),
      );
      requireProof(
        payment.id === paymentIntentId &&
          payment.livemode === record.scope.livemode &&
          payment.customer_account === record.scope.customerAccount &&
          payment.status === "succeeded" &&
          payment.currency === note.currency &&
          referenceId(payment.latest_charge) === chargeId &&
          payment.amount_received >= refund.amount &&
          charge.id === chargeId &&
          charge.payment_intent === paymentIntentId &&
          charge.livemode === record.scope.livemode &&
          charge.currency === note.currency &&
          charge.paid &&
          charge.captured &&
          charge.status === "succeeded" &&
          !charge.disputed &&
          charge.amount_captured >= refund.amount &&
          charge.amount_refunded >= refund.amount &&
          charge.amount_refunded <= charge.amount_captured,
      );
    } else requireProof(note.refunds.length === 0);
    proof = invoiceCorrectionProof.parse({
      creditNoteStatus: note.status,
      stripeAccountId: record.scope.stripeAccountId,
      customerAccount: record.scope.customerAccount,
      livemode: record.scope.livemode,
      stripeCustomerId: record.binding.stripeCustomerId,
      subscriptionId: sub.subscriptionId,
      subscriptionItemId: sub.subscriptionItemId,
      stripePriceId: record.binding.stripePriceId,
      period: sub.period,
      creditNoteId: note.id,
      invoiceId: invoice.id,
      invoiceLineId: line!.id,
      currency: note.currency,
      amount: note.amount,
      prePaymentAmount: note.pre_payment_amount,
      postPaymentAmount: note.post_payment_amount,
      paymentIntentId,
      chargeId,
      refundId,
    });
  } catch {
    return {
      status: "held" as const,
      reason: "native_invoice_adjustment_unverified",
    };
  }
  const saved = (await runMutationOrThrow(
    ctx,
    componentRef(component, "usageCorrections/invoice/adopt"),
    { key: row.key, proofJson: JSON.stringify(proof) },
  )) as Doc<"usageCorrections">;
  return correctionView(saved);
}
