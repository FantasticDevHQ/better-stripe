import { findCreditPurchase } from "./creditRead.js";
import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import type { Doc } from "../../component/_generated/dataModel.js";
import {
  creditPurchaseTerms,
  UsageCreditRecoveryError,
  type UsageCreditPurchaseOptions,
} from "./creditTerms.js";
import {
  creditCall,
  nativeCustomerId,
  creditRequire,
  verifyCreditRealm,
  paymentIdentity,
  verifiedCreditPayment,
} from "./creditNative.js";
import { observeCreditPurchase } from "./creditProvider.js";
import { verifyCreditInvoice } from "./creditInvoice.js";
import { creditNativeObservation } from "./creditProofs.js";
import type { UsageCreditReconciliation } from "./creditObservation.js";
const id = (v: string | { id: string } | null | undefined) =>
  typeof v === "string" ? v : v?.id;
export async function reconcileCreditPurchase(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  input: UsageCreditPurchaseOptions,
) {
  return creditCall(async () => {
    const terms = creditPurchaseTerms(input);
    let source = await findCreditPurchase(component, ctx, input);
    if (!source.row.creditGrantId) {
      await observeCreditPurchase(stripe, component, ctx, input);
      source = await findCreditPurchase(component, ctx, input);
    }
    const purchase = source.row;
    if (!purchase.creditGrantId || !purchase.paymentIntentId)
      return {
        status: "unavailable" as const,
        reason: "credit_purchase_not_ready",
        retryable: true,
      };
    const proofStartedAt = Date.now();
    const startedAt = (await runMutationOrThrow(
      ctx,
      componentRef(component, "usageCredits/mutations/beginObservation"),
      { inputJson: JSON.stringify(input) },
    )) as number;
    await verifyCreditRealm(stripe, terms, false);
    const payment = await stripe.paymentIntents.retrieve(
      purchase.paymentIntentId,
      { expand: ["latest_charge"] },
    );
    paymentIdentity(payment, terms, purchase.key, purchase.paymentIntentId);
    try {
      creditRequire(
        verifiedCreditPayment(payment, terms),
        "Original credit payment not successful",
      );
    } catch (error) {
      if (!(error instanceof UsageCreditRecoveryError)) throw error;
      await runMutationOrThrow(
        ctx,
        componentRef(component, "usageCredits/mutations/freezePurchase"),
        {
          key: purchase.key,
          paymentIntentId: purchase.paymentIntentId,
          reason: error.reason,
          refundedAmount:
            typeof payment.latest_charge === "object"
              ? payment.latest_charge?.amount_refunded
              : undefined,
        },
      );
    }
    const nativeGrant = await stripe.billing.creditGrants.retrieve(
      purchase.creditGrantId,
    );
    creditRequire(
      nativeGrant.id === purchase.creditGrantId &&
        nativeGrant.customer_account === terms.scope.customerAccount &&
        nativeCustomerId(nativeGrant.customer) ===
          terms.binding.stripeCustomerId &&
        nativeGrant.livemode === terms.scope.livemode &&
        nativeGrant.metadata?.bsUsageCredit === purchase.key &&
        nativeGrant.amount.monetary?.value === terms.amount &&
        nativeGrant.amount.monetary.currency ===
          terms.binding.plan.rate.currency &&
        nativeGrant.applicability_config.scope.prices?.length === 1 &&
        nativeGrant.applicability_config.scope.prices[0].id ===
          terms.binding.stripePriceId,
      "Original native credit grant identity mismatch",
    );
    const [summary, transactions] = await Promise.all([
      stripe.billing.creditBalanceSummaries.retrieve({
        customer_account: terms.scope.customerAccount,
        filter: { type: "credit_grant", credit_grant: purchase.creditGrantId },
      }),
      stripe.billing.creditBalanceTransactions.list({
        customer_account: terms.scope.customerAccount,
        credit_grant: purchase.creditGrantId,
        limit: 100,
      }),
    ]);
    creditRequire(
      summary.livemode === terms.scope.livemode &&
        summary.customer_account === terms.scope.customerAccount &&
        id(summary.customer) === terms.binding.stripeCustomerId &&
        summary.balances.length === 1,
      "Native credit summary scope mismatch",
    );
    const row = summary.balances[0],
      ledger = row.ledger_balance.monetary,
      available = row.available_balance.monetary;
    creditRequire(
      ledger &&
        available &&
        ledger.currency === terms.binding.plan.rate.currency &&
        available.currency === ledger.currency,
      "Native credit summary currency mismatch",
    );
    creditRequire(
      Array.isArray(transactions.data) &&
        transactions.data.length <= 100 &&
        typeof transactions.has_more === "boolean",
      "Native credit transaction proof budget exceeded",
    );
    let granted = 0,
      applied = 0,
      expired = 0,
      voided = 0,
      reinstated = 0;
    let invoicesVerified = true;
    const normalized = [];
    const invoiceProofBudget =
      transactions.data.filter((t) => t.debit?.type === "credits_applied")
        .length <= 10;
    for (const tx of transactions.data) {
      creditRequire(
        id(tx.credit_grant) === purchase.creditGrantId &&
          tx.livemode === terms.scope.livemode &&
          tx.object === "billing.credit_balance_transaction",
        "Native credit transaction identity mismatch",
      );
      const entry =
        tx.type === "credit"
          ? tx.credit
          : tx.type === "debit"
            ? tx.debit
            : null;
      const amount = entry?.amount.monetary;
      creditRequire(
        entry &&
          amount &&
          amount.currency === ledger.currency &&
          Number.isSafeInteger(amount.value) &&
          amount.value >= 0,
        "Native credit transaction amount unsupported",
      );
      const kind = entry.type;
      let invoiceId: string | null = null,
        invoiceLineId: string | null = null;
      if (kind === "credits_granted") granted += amount.value;
      else if (kind === "credits_applied") {
        applied += amount.value;
        invoiceId = id(tx.debit?.credits_applied?.invoice) ?? null;
        invoiceLineId = tx.debit?.credits_applied?.invoice_line_item ?? null;
        if (
          !invoiceProofBudget ||
          !(await verifyCreditInvoice(stripe, component, ctx, terms, tx))
        )
          invoicesVerified = false;
      } else if (kind === "credits_expired") expired += amount.value;
      else if (kind === "credits_voided") voided += amount.value;
      else if (kind === "credits_application_invoice_voided") {
        reinstated += amount.value;
        invoicesVerified = false;
        invoiceId =
          id(tx.credit?.credits_application_invoice_voided?.invoice) ?? null;
        invoiceLineId =
          tx.credit?.credits_application_invoice_voided?.invoice_line_item ??
          null;
      } else creditRequire(false, "Unsupported native credit transaction type");
      normalized.push({
        id: tx.id,
        kind,
        amount: amount.value,
        invoiceId,
        invoiceLineId,
      });
    }
    const proof = creditNativeObservation.parse({
      creditGrantId: purchase.creditGrantId,
      paymentIntentId: purchase.paymentIntentId,
      currency: ledger.currency,
      ledgerAmount: ledger.value,
      availableAmount: available.value,
      granted,
      applied,
      expired,
      voided,
      reinstated,
      invoicesVerified,
      complete: !transactions.has_more,
      transactions: normalized,
    });
    const resultJson = (await runMutationOrThrow(
      ctx,
      componentRef(component, "usageCredits/mutations/saveObservation"),
      {
        inputJson: JSON.stringify(input),
        proofJson: JSON.stringify(proof),
        startedAt,
        proofStartedAt,
      },
    )) as string;
    const result = JSON.parse(resultJson) as UsageCreditReconciliation;
    return {
      status: "available" as const,
      observedAt: Math.floor(proofStartedAt / 1000),
      value: result,
    };
  });
}
export type CreditPurchaseDocument = Doc<"usageCreditPurchases">;
