import { verifyPinnedUsagePrice } from "./catalogPrices.js";
import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import type { FinancialOutcome } from "../financialOutcomes/contracts.js";
import type { UsageCreditPurchaseOptions } from "./creditTerms.js";
import { UsageCreditRecoveryError } from "./creditTerms.js";
import { findCreditPurchase } from "./creditRead.js";
import {
  verifyCreditRealm,
  paymentIdentity,
  verifiedCreditPayment,
} from "./creditNative.js";
import { paymentCreditProof } from "./creditProofs.js";
import { saleAmountFailure } from "../paymentSource/economics.js";
export type UsageCreditRevenue = {
  purchaseId: string;
  paymentIntentId: string;
  chargeId: string;
  creditGrantId: string;
  stripeAccountId: string;
  customerAccount: string;
  livemode: boolean;
  stripePriceId: string;
  stripeProductId: string;
  gross: number;
  processingFee: number;
  currency: string;
  ownership: "issuer";
};
/** Original issuer-service revenue only. Credit consumption never creates a second sale. */
export async function getCreditPurchaseRevenue(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  input: UsageCreditPurchaseOptions,
): Promise<FinancialOutcome<UsageCreditRevenue>> {
  try {
    const { row, terms } = await findCreditPurchase(component, ctx, input);
    if (row.state === "frozen" || row.state === "canceled")
      return {
        status: "rejected",
        reason: "payment_not_payable",
        retryable: false,
      };
    if (
      row.state !== "ready" ||
      !row.paymentIntentId ||
      !row.paymentProofJson ||
      !row.creditGrantId
    )
      return {
        status: "not_ready",
        reason: "provider_pending",
        retryable: true,
      };
    await verifyCreditRealm(stripe, terms, false);
    const [payment, price] = await Promise.all([
      stripe.paymentIntents.retrieve(row.paymentIntentId, {
        expand: ["latest_charge.balance_transaction"],
      }),
      stripe.prices.retrieve(terms.binding.stripePriceId, {
        expand: ["tiers"],
      }),
    ]);
    paymentIdentity(payment, terms, row.key, row.paymentIntentId);
    const proof = verifiedCreditPayment(payment, terms),
      retained = paymentCreditProof.parse(JSON.parse(row.paymentProofJson));
    if (
      !proof ||
      proof.chargeId !== retained.chargeId ||
      price.id !== terms.binding.stripePriceId
    )
      return {
        status: "conflict",
        reason: "identity_changed",
        retryable: false,
      };
    verifyPinnedUsagePrice(
      price,
      {
        stripeAccountId: terms.scope.stripeAccountId,
        livemode: terms.scope.livemode,
      },
      terms.binding.plan,
      terms.scope.meterId,
      false,
    );
    const charge = payment.latest_charge;
    if (!charge || typeof charge === "string")
      return {
        status: "not_ready",
        reason: "provider_pending",
        retryable: true,
      };
    const customerId = (value: string | { id: string } | null | undefined) =>
      typeof value === "string" ? value : value?.id;
    if (
      customerId(payment.customer) !== terms.binding.stripeCustomerId ||
      customerId(charge.customer) !== terms.binding.stripeCustomerId ||
      charge.transfer
    )
      return {
        status: "conflict",
        reason: "identity_changed",
        retryable: false,
      };
    const balanceRef = charge.balance_transaction;
    if (!balanceRef)
      return { status: "not_ready", reason: "fee_pending", retryable: true };
    const balance =
      typeof balanceRef === "string"
        ? await stripe.balanceTransactions.retrieve(balanceRef)
        : balanceRef;
    const sourceId =
      typeof balance.source === "string" ? balance.source : balance.source?.id;
    if (
      (typeof balanceRef === "string" && balance.id !== balanceRef) ||
      balance.object !== "balance_transaction" ||
      sourceId !== charge.id ||
      saleAmountFailure(payment, charge, balance) ||
      balance.amount !== terms.amount ||
      balance.net !== balance.amount - balance.fee ||
      !Number.isSafeInteger(balance.amount) ||
      !Number.isSafeInteger(balance.net)
    )
      return {
        status: "rejected",
        reason: "unsupported_source",
        retryable: false,
      };
    return {
      status: "ready",
      value: {
        purchaseId: terms.purchaseId,
        paymentIntentId: proof.paymentIntentId,
        chargeId: proof.chargeId,
        creditGrantId: row.creditGrantId,
        stripeAccountId: terms.scope.stripeAccountId,
        customerAccount: terms.scope.customerAccount,
        livemode: terms.scope.livemode,
        stripePriceId: price.id,
        stripeProductId:
          typeof price.product === "string" ? price.product : price.product.id,
        gross: terms.amount,
        processingFee: balance.fee,
        currency: payment.currency,
        ownership: "issuer",
      },
    };
  } catch (error) {
    if (error instanceof UsageCreditRecoveryError)
      return {
        status: "rejected",
        reason: "payment_not_payable",
        retryable: false,
      };
    return {
      status: "unknown",
      reason: "provider_outcome_unknown",
      retryable: false,
    };
  }
}
