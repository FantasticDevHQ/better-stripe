import Stripe from "stripe";

import { getSubscriptionFromStripe } from "./providerReads.js";

/** Trusted host selectors only; authenticate and freeze this entire tuple before calling. */
export type SubscriptionPaymentMethodOptions = {
  stripeSubscriptionId: string;
  customerAccount: string;
  paymentMethodId: string;
  idempotencyKey: string;
  connectedAccountId?: string;
};

export type SubscriptionPaymentMethodResult =
  | {
      status: "updated";
      stripeSubscriptionId: string;
      customerAccount: string;
      paymentMethodId: string;
      observedAt: number;
    }
  | {
      status: "unsupported";
      reason:
        | "managed_payments"
        | "unknown_managed_payments"
        | "non_v2_payer"
        | "non_card_method";
    }
  | {
      status: "unavailable";
      reason:
        | "invalid_selector"
        | "subscription_mismatch"
        | "payer_mismatch"
        | "method_mismatch"
        | "method_owner_mismatch"
        | "provider_read_unavailable";
    }
  | {
      status: "unknown";
      reason: "provider_write_unconfirmed" | "response_mismatch";
    };

function isValidOptions(opts: SubscriptionPaymentMethodOptions) {
  const identifiers: [string, RegExp][] = [
    [opts.stripeSubscriptionId, /^sub_[A-Za-z0-9_]+$/],
    [opts.customerAccount, /^acct_[A-Za-z0-9_]+$/],
    [opts.paymentMethodId, /^pm_[A-Za-z0-9_]+$/],
  ];
  if (opts.connectedAccountId !== undefined)
    identifiers.push([opts.connectedAccountId, /^acct_[A-Za-z0-9_]+$/]);
  return (
    identifiers.every(
      ([value, pattern]) =>
        typeof value === "string" && value.length <= 255 && pattern.test(value),
    ) &&
    typeof opts.idempotencyKey === "string" &&
    opts.idempotencyKey.length > 0 &&
    opts.idempotencyKey.length <= 255 &&
    opts.idempotencyKey.trim() === opts.idempotencyKey &&
    !/[\u0000-\u001f\u007f]/.test(opts.idempotencyKey)
  );
}

function originalSubscriptionFailure(
  subscription: Stripe.Subscription,
  opts: SubscriptionPaymentMethodOptions,
): Extract<
  SubscriptionPaymentMethodResult,
  { status: "unsupported" | "unavailable" }
> | null {
  if (subscription.id !== opts.stripeSubscriptionId)
    return { status: "unavailable", reason: "subscription_mismatch" };
  if (typeof subscription.customer_account !== "string")
    return { status: "unsupported", reason: "non_v2_payer" };
  if (subscription.customer_account !== opts.customerAccount)
    return { status: "unavailable", reason: "payer_mismatch" };
  if (subscription.managed_payments?.enabled === true)
    return { status: "unsupported", reason: "managed_payments" };
  if (
    subscription.managed_payments !== null &&
    subscription.managed_payments?.enabled !== false
  )
    return { status: "unsupported", reason: "unknown_managed_payments" };
  return null;
}

function isConfirmedSelection(
  subscription: Stripe.Subscription,
  opts: SubscriptionPaymentMethodOptions,
) {
  if (originalSubscriptionFailure(subscription, opts)) return false;
  const method = subscription.default_payment_method;
  return typeof method === "string"
    ? method === opts.paymentMethodId
    : method?.id === opts.paymentMethodId &&
        method.type === "card" &&
        method.customer_account === opts.customerAccount;
}

/** Platform reads reuse the existing provider reader; explicit Connect scope stays unchanged on every call. */
function readOriginalSubscription(
  stripe: Stripe,
  opts: SubscriptionPaymentMethodOptions,
) {
  return opts.connectedAccountId === undefined
    ? getSubscriptionFromStripe(stripe, {
        stripeSubscriptionId: opts.stripeSubscriptionId,
      })
    : stripe.subscriptions.retrieve(
        opts.stripeSubscriptionId,
        {},
        { stripeAccount: opts.connectedAccountId },
      );
}

/** One SDK update, then a fresh observation. No package retry, shared default update, charge or component write. */
export async function updateSubscriptionDefaultPaymentMethod(
  stripe: Stripe,
  opts: SubscriptionPaymentMethodOptions,
): Promise<SubscriptionPaymentMethodResult> {
  if (!isValidOptions(opts))
    return { status: "unavailable", reason: "invalid_selector" };
  const realm =
    opts.connectedAccountId === undefined
      ? undefined
      : { stripeAccount: opts.connectedAccountId };
  let isDispatched = false;
  try {
    const original = await readOriginalSubscription(stripe, opts);
    const failure = originalSubscriptionFailure(original, opts);
    if (failure) return failure;
    const method = await stripe.paymentMethods.retrieve(
      opts.paymentMethodId,
      {},
      realm,
    );
    if (method.id !== opts.paymentMethodId)
      return { status: "unavailable", reason: "method_mismatch" };
    if (method.type !== "card")
      return { status: "unsupported", reason: "non_card_method" };
    if (method.customer_account !== opts.customerAccount)
      return { status: "unavailable", reason: "method_owner_mismatch" };
    isDispatched = true;
    const updated = await stripe.subscriptions.update(
      opts.stripeSubscriptionId,
      { default_payment_method: opts.paymentMethodId },
      { ...realm, idempotencyKey: opts.idempotencyKey },
    );
    if (!isConfirmedSelection(updated, opts))
      return { status: "unknown", reason: "response_mismatch" };
    // An idempotent POST can replay an old selection. Only a new GET can confirm current state.
    const current = await readOriginalSubscription(stripe, opts);
    if (!isConfirmedSelection(current, opts))
      return { status: "unknown", reason: "response_mismatch" };
    return {
      status: "updated",
      stripeSubscriptionId: opts.stripeSubscriptionId,
      customerAccount: opts.customerAccount,
      paymentMethodId: opts.paymentMethodId,
      observedAt: Date.now(),
    };
  } catch (error) {
    if (!(error instanceof Stripe.errors.StripeError)) throw error;
    if (isDispatched)
      return { status: "unknown", reason: "provider_write_unconfirmed" };
    return { status: "unavailable", reason: "provider_read_unavailable" };
  }
}
