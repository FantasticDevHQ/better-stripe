import { findCreditPurchase } from "./creditRead.js";
import { reconcileCreditPurchase } from "./creditReconciliation.js";
import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import {
  UsageCreditError,
  type UsageCreditPurchaseOptions,
} from "./creditTerms.js";
import {
  creditCall,
  creditRequire,
  verifyCreditRealm,
  discoverCredit,
  paymentIdentity,
  verifiedCreditPayment,
} from "./creditNative.js";
import { creditPurchaseView } from "./creditProvider.js";
export async function cancelCreditPurchase(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  input: UsageCreditPurchaseOptions,
) {
  return creditCall(async () => {
    const { row, terms } = await findCreditPurchase(component, ctx, input);
    await verifyCreditRealm(stripe, terms);
    creditRequire(
      !row.creditGrantId && !row.paymentProofJson,
      "Paid credit purchases require refund recovery",
    );
    let payment = row.paymentIntentId
      ? await stripe.paymentIntents.retrieve(row.paymentIntentId)
      : await discoverCredit(row.key, (cursor) =>
          stripe.paymentIntents.list({
            customer_account: terms.scope.customerAccount,
            limit: 100,
            ...(cursor ? { starting_after: cursor } : {}),
          }),
        );
    if (!payment)
      throw new UsageCreditError(
        "unknown_create_outcome",
        "Unknown original payment requires reconciliation before abandonment",
      );
    paymentIdentity(payment, terms, row.key, row.paymentIntentId);
    await runMutationOrThrow(
      ctx,
      componentRef(component, "usageCredits/mutations/pinPayment"),
      { key: row.key, paymentIntentId: payment.id },
    );
    if (payment.status !== "canceled") {
      creditRequire(
        [
          "requires_payment_method",
          "requires_confirmation",
          "requires_action",
        ].includes(payment.status),
        "Pending or successful payment requires observation before cancellation",
      );
      payment = await stripe.paymentIntents.cancel(
        payment.id,
        { cancellation_reason: "requested_by_customer" },
        { idempotencyKey: "bs_usage_credit_cancel_" + row.key },
      );
    }
    creditRequire(
      payment.status === "canceled",
      "Native credit payment cancellation unconfirmed",
    );
    paymentIdentity(payment, terms, row.key, row.paymentIntentId);
    await runMutationOrThrow(
      ctx,
      componentRef(component, "usageCredits/mutations/cancelPurchase"),
      { key: row.key, paymentIntentId: payment.id },
    );
    return creditPurchaseView({
      ...row,
      state: "canceled",
      paymentIntentId: payment.id,
    });
  });
}

/** Disable only wholly unspent native credits before the existing monetary refund API. */
export async function prepareCreditRefund(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  input: UsageCreditPurchaseOptions,
) {
  return creditCall(async () => {
    const { row, terms } = await findCreditPurchase(component, ctx, input);
    await verifyCreditRealm(stripe, terms, false);
    creditRequire(
      row.creditGrantId && row.paymentIntentId,
      "Verified credit purchase required",
    );
    const originalPayment = await stripe.paymentIntents.retrieve(
      row.paymentIntentId,
      { expand: ["latest_charge"] },
    );
    paymentIdentity(originalPayment, terms, row.key, row.paymentIntentId);
    creditRequire(
      verifiedCreditPayment(originalPayment, terms),
      "Original credit purchase payment unavailable",
    );
    const observation = await reconcileCreditPurchase(
      stripe,
      component,
      ctx,
      input,
    );
    creditRequire(
      observation.status === "available" &&
        observation.value.applied === 0 &&
        observation.value.reinstated === 0 &&
        (observation.value.ledgerAmount === terms.amount ||
          (observation.value.ledgerAmount === 0 &&
            observation.value.expired + observation.value.voided ===
              terms.amount)),
      "Current credit reconciliation required",
    );
    await runMutationOrThrow(
      ctx,
      componentRef(component, "usageCredits/mutations/prepareRefund"),
      { key: row.key },
    );
    const grant = await stripe.billing.creditGrants.retrieve(row.creditGrantId);
    creditRequire(
      grant.id === row.creditGrantId &&
        grant.customer_account === terms.scope.customerAccount &&
        grant.livemode === terms.scope.livemode &&
        grant.metadata?.bsUsageCredit === row.key,
      "Original credit grant identity mismatch",
    );
    if (
      !grant.voided_at &&
      (grant.expires_at === null || grant.expires_at > Date.now() / 1000)
    )
      await stripe.billing.creditGrants.expire(
        grant.id,
        {},
        { idempotencyKey: "bs_usage_credit_expire_" + row.key },
      );
    const result = await reconcileCreditPurchase(stripe, component, ctx, input);
    creditRequire(
      result.status === "available" &&
        result.value.backing === "sufficient" &&
        result.value.ledgerAmount === 0 &&
        result.value.applied === 0 &&
        result.value.reinstated === 0 &&
        result.value.expired + result.value.voided === terms.amount,
      "Native credit expiration not yet confirmed",
    );
    return {
      paymentIntentId: row.paymentIntentId,
      amount: terms.amount,
      currency: terms.binding.plan.rate.currency,
      creditGrantId: row.creditGrantId,
      creditState: "disabled" as const,
      cashRefund: "required" as const,
    };
  });
}
