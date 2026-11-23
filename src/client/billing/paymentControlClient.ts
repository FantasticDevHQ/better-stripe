import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import {
  cancelPaymentIntent,
  confirmPaymentIntent,
  expireCheckoutSession,
  getPaymentIntentState,
  preparePaymentIntent,
  type CancelPaymentIntentOptions,
  type ConfirmPaymentIntentOptions,
  type ExpireCheckoutSessionOptions,
  type PaymentIntentOwnerOptions,
  type PreparePaymentIntentOptions,
} from "./paymentControl.js";

/**
 * Server-gated payment control, reached as `betterStripe.paymentControl`.
 * Server-only: the host authenticates the caller and authorizes the payment
 * (for example, checks that its hold is still active) before each call.
 */
export class PaymentControlClient {
  constructor(
    private readonly component: Component,
    private readonly stripe: () => Stripe,
  ) {}

  /** Create an unconfirmed, card-only payment for a server-priced amount. */
  prepare(ctx: RunCtx, opts: PreparePaymentIntentOptions) {
    return preparePaymentIntent(this.stripe(), this.component, ctx, opts);
  }

  /** Confirm a prepared payment from a Stripe.js ConfirmationToken, before `notAfter`. */
  confirm(ctx: RunCtx, opts: ConfirmPaymentIntentOptions) {
    return confirmPaymentIntent(this.stripe(), this.component, ctx, opts);
  }

  /** Cancel a payment the component created, idempotently. */
  cancel(ctx: RunCtx, opts: CancelPaymentIntentOptions) {
    return cancelPaymentIntent(this.stripe(), this.component, ctx, opts);
  }

  /** Authoritative live state of a payment the component created. */
  getState(ctx: RunCtx, opts: PaymentIntentOwnerOptions) {
    return getPaymentIntentState(this.stripe(), this.component, ctx, opts);
  }

  /** Expire an open Checkout Session the component created, idempotently. */
  expireCheckoutSession(ctx: RunCtx, opts: ExpireCheckoutSessionOptions) {
    return expireCheckoutSession(this.stripe(), this.component, ctx, opts);
  }
}
