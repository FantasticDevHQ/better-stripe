import type Stripe from "stripe";
import { STRIPE_CUSTOMER_PREVIEW_API_VERSION } from "../apiVersion.js";
import { idempotencyOptions } from "../core/idempotency.js";
import { resolveOwnerAccount } from "../utils/owner.js";

export type BalanceFundingCapability = {
  configured: boolean;
  requiredApiVersion: typeof STRIPE_CUSTOMER_PREVIEW_API_VERSION;
  requiresConnectedAccount: true;
  eligibility: "provider_validates_on_prepare";
};
export function getBalanceFundingCapability(
  version: string,
): BalanceFundingCapability {
  return {
    configured: version === STRIPE_CUSTOMER_PREVIEW_API_VERSION,
    requiredApiVersion: STRIPE_CUSTOMER_PREVIEW_API_VERSION,
    requiresConnectedAccount: true,
    eligibility: "provider_validates_on_prepare",
  };
}
export type BalanceFundingScope = {
  customerAccount: string;
  stripeSubscriptionId: string;
};
/** Persist server-side before applying; never accept this record from a browser. */
export type BalanceFundingPreparation = BalanceFundingScope & {
  paymentMethodId: string;
  previousPaymentMethodId: string | null;
  previousPaymentMethodTypes: string[] | null;
};
export type PrepareBalanceFundingOptions = BalanceFundingScope & {
  consent: true;
  idempotencyKey: string;
};
export type SetBalanceFundingOptions = {
  preparation: BalanceFundingPreparation;
  enabled: boolean;
  consent?: true;
  idempotencyKey: string;
};
function request(version: string, key: string, phase: string) {
  if (!getBalanceFundingCapability(version).configured)
    throw new Error(
      "Balance funding requires explicit Stripe preview API configuration.",
    );
  idempotencyOptions(key);
  return idempotencyOptions(`${key}:${phase}`)!;
}
async function subscription(stripe: Stripe, scope: BalanceFundingScope) {
  if (!scope.customerAccount.startsWith("acct_") || !scope.stripeSubscriptionId)
    throw new Error("A customer account and subscription are required.");
  const sub = await stripe.subscriptions.retrieve(scope.stripeSubscriptionId);
  if (resolveOwnerAccount(sub) !== scope.customerAccount)
    throw new Error("Subscription does not belong to the customer account.");
  if (!["active", "past_due", "trialing"].includes(sub.status))
    throw new Error("This subscription cannot change payment sources.");
  return sub;
}
function methodId(sub: Stripe.Subscription) {
  const pm = sub.default_payment_method;
  return typeof pm === "string" ? pm : (pm?.id ?? null);
}

/** Capture restoration settings, provision and attach; does not enable billing. */
export async function prepareBalanceFunding(
  stripe: Stripe,
  version: string,
  opts: PrepareBalanceFundingOptions,
): Promise<BalanceFundingPreparation> {
  const createOptions = request(version, opts.idempotencyKey, "create");
  const attachOptions = request(version, opts.idempotencyKey, "attach");
  if (opts.consent !== true)
    throw new Error("Explicit consent is required for balance funding.");
  const sub = await subscription(stripe, opts);
  const previous = methodId(sub);
  const types = sub.payment_settings?.payment_method_types ?? null;
  if (
    types?.includes("stripe_balance") ||
    (previous &&
      (await stripe.paymentMethods.retrieve(previous)).type ===
        "stripe_balance")
  )
    throw new Error(
      "Balance funding is already configured; reuse the persisted restoration record.",
    );
  const pm = await stripe.paymentMethods.create(
    { type: "stripe_balance" },
    createOptions,
  );
  if (pm.type !== "stripe_balance")
    throw new Error("Stripe did not return a balance payment method.");
  const current = await stripe.paymentMethods.retrieve(pm.id);
  if (resolveOwnerAccount(current) === null) {
    await stripe.paymentMethods.attach(
      pm.id,
      { customer_account: opts.customerAccount },
      attachOptions,
    );
  } else if (resolveOwnerAccount(current) !== opts.customerAccount) {
    throw new Error(
      "Balance payment method belongs to a different customer account.",
    );
  }
  return {
    customerAccount: opts.customerAccount,
    stripeSubscriptionId: opts.stripeSubscriptionId,
    paymentMethodId: pm.id,
    previousPaymentMethodId: previous,
    previousPaymentMethodTypes: types,
  };
}
function sameTypes(a: string[] | null, b: string[] | null) {
  return a === null || b === null
    ? a === b
    : a.length === b.length &&
        [...a].sort().every((type, i) => type === [...b].sort()[i]);
}

/** Apply a host-persisted preparation. Host serializes changes per subscription. */
export async function setBalanceFunding(
  stripe: Stripe,
  version: string,
  opts: SetBalanceFundingOptions,
): Promise<{ enabled: boolean }> {
  const requestOptions = request(
    version,
    opts.idempotencyKey,
    opts.enabled ? "enable" : "disable",
  );
  if (opts.enabled && opts.consent !== true)
    throw new Error("Explicit consent is required for balance funding.");
  const prep = opts.preparation;
  const sub = await subscription(stripe, prep);
  const pm = await stripe.paymentMethods.retrieve(prep.paymentMethodId);
  if (
    pm.type !== "stripe_balance" ||
    resolveOwnerAccount(pm) !== prep.customerAccount
  )
    throw new Error(
      "Balance payment method does not belong to the customer account.",
    );
  const original =
    methodId(sub) === prep.previousPaymentMethodId &&
    sameTypes(
      sub.payment_settings?.payment_method_types ?? null,
      prep.previousPaymentMethodTypes,
    );
  const balance =
    methodId(sub) === prep.paymentMethodId &&
    sameTypes(sub.payment_settings?.payment_method_types ?? null, [
      "stripe_balance",
    ]);
  if (!original && !balance)
    throw new Error(
      "Subscription payment settings changed; reconcile before applying this restoration record.",
    );
  if ((opts.enabled && balance) || (!opts.enabled && original))
    return { enabled: opts.enabled };
  await stripe.subscriptions.update(
    sub.id,
    {
      default_payment_method: opts.enabled
        ? prep.paymentMethodId
        : (prep.previousPaymentMethodId ?? ""),
      payment_settings: {
        payment_method_types: opts.enabled
          ? ["stripe_balance"]
          : (prep.previousPaymentMethodTypes ?? ""),
      },
    },
    requestOptions,
  );
  return { enabled: opts.enabled };
}
