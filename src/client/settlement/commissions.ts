import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import { isBetterStripeError, throwStripeError } from "../errors.js";
export type CommissionTerm = "forever" | "one_time";
export type CommissionSelectionOptions = {
  subscriptionId: string;
  invoiceId: string;
  affiliateAccountId?: string;
  term?: CommissionTerm;
  maxHistoryPages?: number;
};
export type CommissionDecision = {
  eligible: boolean;
  term: CommissionTerm;
  firstPaidInvoiceId: string;
  claimKey: string;
  replay: boolean;
};
export type CommissionSelection =
  | ({ status: "ready" } & CommissionDecision)
  | { status: "not_payable"; eligible: false; reason: string };
type Stored = {
  subscriptionId: string;
  term: CommissionTerm;
  affiliateAccountId?: string;
  firstPaidInvoiceId: string;
};
/** Durable selection only. Replay returns the same award key; execute through settleSale. */
export async function selectCommissionInvoice(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: CommissionSelectionOptions,
): Promise<CommissionSelection> {
  try {
    const invoice = await stripe.invoices.retrieve(opts.invoiceId);
    const pointer = invoice.parent?.subscription_details?.subscription;
    if (
      (typeof pointer === "string" ? pointer : pointer?.id) !==
      opts.subscriptionId
    )
      throwStripeError(
        "INVALID_CONFIGURATION",
        "Invoice does not belong to this subscription.",
      );
    if (invoice.status !== "paid" || invoice.amount_paid <= 0)
      return {
        status: "not_payable",
        eligible: false,
        reason: "invoice_not_paid_or_zero",
      };
    const stored = (await ctx.runQuery(
      componentRef(component, "settlement/queries/getCommissionTerm"),
      { subscriptionId: opts.subscriptionId },
    )) as Stored | null;
    let firstPaidInvoiceId = stored?.firstPaidInvoiceId ?? invoice.id;
    const term = stored?.term ?? opts.term ?? "forever";
    if (!stored && term === "one_time") {
      const max = opts.maxHistoryPages ?? 100;
      if (!Number.isInteger(max) || max < 1 || max > 1000)
        throwStripeError(
          "INVALID_CONFIGURATION",
          "Invalid invoice history page bound.",
        );
      let cursor: string | undefined,
        earliest: number = Infinity,
        complete = false;
      for (let i = 0; i < max; i++) {
        const batch = await stripe.invoices.list({
          subscription: opts.subscriptionId,
          status: "paid",
          limit: 100,
          starting_after: cursor,
        });
        for (const row of batch.data)
          if (row.amount_paid > 0) {
            const paid = row.status_transitions.paid_at ?? row.created;
            if (
              paid < earliest ||
              (paid === earliest && row.id < firstPaidInvoiceId)
            ) {
              earliest = paid;
              firstPaidInvoiceId = row.id;
            }
          }
        if (!batch.has_more) {
          complete = true;
          break;
        }
        const next = batch.data[batch.data.length - 1]?.id;
        if (!next || next === cursor)
          throwStripeError(
            "STRIPE_API_ERROR",
            "Invoice pagination did not advance.",
          );
        cursor = next;
      }
      if (!complete || !Number.isFinite(earliest))
        throwStripeError(
          "INVALID_CONFIGURATION",
          "First paid invoice could not be established from complete history.",
        );
    }
    const decision = (await runMutationOrThrow(
      ctx,
      componentRef(component, "settlement/mutations/claimCommissionInvoice"),
      {
        subscriptionId: opts.subscriptionId,
        invoiceId: invoice.id,
        firstPaidInvoiceId,
        affiliateAccountId: opts.affiliateAccountId,
        term,
      },
    )) as CommissionDecision;
    return { status: "ready", ...decision };
  } catch (error) {
    if (isBetterStripeError(error)) throw error;
    throwStripeError(
      "STRIPE_API_ERROR",
      "Could not select subscription commission invoice.",
    );
  }
}
