import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import type { StripeComponentPayment } from "../types.js";
import { componentRef } from "../webhooks/helpers.js";
import { assertRefundAuthorized } from "./refunds.js";
import {
  readRefundPayment,
  readRefundCharge,
  refundObjectId,
} from "./refundTarget.js";
import { readRefundHistory } from "./refundContextHistory.js";
import {
  refundContextOptionsSchema,
  type RefundContextOptions,
  type RefundContext,
  type RefundContextUnavailableReason,
} from "./refundContextTypes.js";

const unavailable = (
  reason: RefundContextUnavailableReason,
): RefundContext => ({ status: "unavailable", reason });
function amountsAgree(payment: Stripe.PaymentIntent, charge: Stripe.Charge) {
  const amounts = [
    payment.amount,
    payment.amount_received,
    charge.amount,
    charge.amount_captured,
    charge.amount_refunded,
  ];
  return (
    amounts.every((n) => Number.isSafeInteger(n) && n >= 0) &&
    charge.amount_captured === payment.amount_received &&
    charge.amount_captured <= charge.amount &&
    charge.amount_captured <= payment.amount &&
    charge.amount_refunded <= charge.amount_captured
  );
}

function canonicalCustomer(value: Stripe.PaymentIntent["customer"]) {
  if (value === null) return true;
  if (typeof value === "string") return /^cus_[A-Za-z0-9_]+$/.test(value);
  return Boolean(
    value &&
    value.object === "customer" &&
    typeof value.id === "string" &&
    /^cus_[A-Za-z0-9_]+$/.test(value.id),
  );
}

/** Observes one authorized original payment; hosts still own community scope and creation-time revalidation. */
export async function getRefundContext(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  input: RefundContextOptions,
): Promise<RefundContext> {
  const opts = refundContextOptionsSchema.parse(input);
  const original =
    (await assertRefundAuthorized(stripe, component, ctx, opts)) ??
    ((await ctx.runQuery(
      componentRef(component, "connect/queries/getPaymentByStripeId"),
      { stripePaymentIntentId: opts.stripePaymentIntentId },
    )) as StripeComponentPayment | null);
  if (!original) return unavailable("payment_unavailable");
  if (original.stripePaymentIntentId !== opts.stripePaymentIntentId)
    return unavailable("payment_scope_mismatch");
  const buyer = original.accountId;
  if (!buyer || !/^acct_[A-Za-z0-9_]+$/.test(buyer))
    return unavailable("buyer_unavailable");
  const payment = await readRefundPayment(stripe, opts);
  if (
    !payment ||
    payment.object !== "payment_intent" ||
    payment.id !== opts.stripePaymentIntentId
  )
    return unavailable("payment_scope_mismatch");
  if (!canonicalCustomer(payment.customer))
    return unavailable("buyer_mismatch");
  if (payment.customer_account !== buyer) return unavailable("buyer_mismatch");
  if (payment.status !== "succeeded")
    return unavailable("payment_not_succeeded");
  if (
    !/^[a-z]{3}$/.test(payment.currency) ||
    payment.currency !== original.currency
  )
    return unavailable("currency_mismatch");
  const chargeId = refundObjectId(payment.latest_charge);
  if (!chargeId || !/^ch_[A-Za-z0-9_]+$/.test(chargeId))
    return unavailable("charge_unavailable");
  const charge = await readRefundCharge(stripe, opts, payment);
  if (
    !charge ||
    charge.id !== chargeId ||
    refundObjectId(charge.payment_intent) !== payment.id
  )
    return unavailable("charge_scope_mismatch");
  if (
    charge.object !== "charge" ||
    charge.status !== "succeeded" ||
    typeof charge.paid !== "boolean" ||
    typeof charge.captured !== "boolean" ||
    typeof charge.disputed !== "boolean" ||
    typeof charge.refunded !== "boolean"
  )
    return unavailable("charge_scope_mismatch");
  if (!canonicalCustomer(charge.customer)) return unavailable("buyer_mismatch");
  if (refundObjectId(charge.customer) !== refundObjectId(payment.customer))
    return unavailable("buyer_mismatch");
  if (charge.currency !== payment.currency)
    return unavailable("currency_mismatch");
  if (!amountsAgree(payment, charge)) return unavailable("amount_unavailable");
  if (!charge.paid || !charge.captured)
    return unavailable("charge_not_captured");
  if (charge.disputed) return unavailable("charge_disputed");
  const history = await readRefundHistory(stripe, {
    paymentIntentId: payment.id,
    chargeId: charge.id,
    currency: payment.currency,
    capturedAmount: charge.amount_captured,
    maxRefundPages: opts.maxRefundPages,
    stripeAccountId: opts.stripeAccountId,
  });
  if (history.status !== "complete") return history;
  if (
    history.refundedAmount !== charge.amount_refunded ||
    (charge.refunded && history.refundedAmount !== charge.amount_captured)
  )
    return unavailable("refund_counter_mismatch");
  return {
    status: "ready",
    stripePaymentIntentId: payment.id,
    stripeChargeId: charge.id,
    customerAccount: buyer,
    currency: payment.currency,
    capturedAmount: charge.amount_captured,
    refundedAmount: history.refundedAmount,
    remainingRefundableAmount: charge.amount_captured - history.refundedAmount,
    observedAt: Date.now(),
  };
}
