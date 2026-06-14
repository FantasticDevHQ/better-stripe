import type Stripe from "stripe";

import type { RunCtx } from "../helpers.js";
import { throwStripeError } from "../errors.js";

// =============================================================================
// Payment Method methods
// =============================================================================

export async function listPaymentMethods(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: { stripeCustomerId: string; type?: string },
) {
  const methods = await stripe.paymentMethods.list({
    customer_account: opts.stripeCustomerId,
    type: (opts.type as Stripe.PaymentMethodListParams.Type) ?? "card",
  });
  return methods.data;
}

export async function getPaymentMethod(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: { paymentMethodId: string },
) {
  return await stripe.paymentMethods.retrieve(opts.paymentMethodId);
}

export async function attachPaymentMethod(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: { paymentMethodId: string; stripeCustomerId: string },
) {
  await stripe.paymentMethods.attach(opts.paymentMethodId, {
    customer_account: opts.stripeCustomerId,
  });
  return { success: true };
}

export async function detachPaymentMethod(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: { paymentMethodId: string },
) {
  return await stripe.paymentMethods.detach(opts.paymentMethodId);
}

export async function setDefaultPaymentMethod(
  _stripe: Stripe,
  _ctx: RunCtx,
  _opts: { stripeAccountId: string; paymentMethodId: string },
) {
  throwStripeError("PAYMENT_METHOD_FAILED", "[better-stripe] setDefaultPaymentMethod is not yet implemented for V2 Accounts. Use createBillingPortalSession() to let users manage payment methods.");
}
