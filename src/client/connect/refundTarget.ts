import type Stripe from "stripe";

export function refundObjectId(
  value: string | { id: string } | null | undefined,
) {
  return typeof value === "string" ? value : value?.id;
}
export type RefundTargetOptions = {
  stripePaymentIntentId?: string;
  stripeChargeId?: string;
  stripeAccountId?: string;
};
/** Shared target resolution; caller authorization and observation validation remain separate. */
export async function readRefundPayment(
  stripe: Stripe,
  opts: RefundTargetOptions,
) {
  if (!opts.stripePaymentIntentId) return null;
  return stripe.paymentIntents.retrieve(
    opts.stripePaymentIntentId,
    undefined,
    opts.stripeAccountId ? { stripeAccount: opts.stripeAccountId } : undefined,
  );
}
/** Resolve only the selected original charge; does not create refunds or inspect fees. */
export async function readRefundCharge(
  stripe: Stripe,
  opts: RefundTargetOptions,
  payment: Stripe.PaymentIntent | null,
) {
  const chargeId =
    opts.stripeChargeId ?? refundObjectId(payment?.latest_charge);
  if (!chargeId) return null;
  return stripe.charges.retrieve(
    chargeId,
    undefined,
    opts.stripeAccountId ? { stripeAccount: opts.stripeAccountId } : undefined,
  );
}
