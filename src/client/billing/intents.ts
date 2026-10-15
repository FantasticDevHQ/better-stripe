import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { stripReservedMetadata } from "../helpers.js";
import { idempotencyOptions } from "../core/idempotency.js";
import { componentRef } from "../webhooks/helpers.js";

/** Host must derive userId from authentication and authorize the purchase. */
export type IntentScope = {
  userId: string;
  customerAccount?: string;
  /** Persist the logical request and its immutable inputs before calling. */
  idempotencyKey: string;
  /** Server-selected attribution only. Never forward arbitrary browser metadata. */
  metadata?: Record<string, string>;
};
export type CreatePaymentIntentOptions = IntentScope & {
  stripePriceId: string;
  receiptEmail?: string;
  /** Card-only by default; automatic preserves host-selected local payment methods. */
  paymentMethods?: "card" | "automatic";
};
export type CreateSetupIntentOptions = IntentScope & {
  customerAccount: string;
  usage: "on_session" | "off_session";
  /** Host records consent for the selected usage before provisioning. */
  consent: true;
};
async function authorize(component: Component, ctx: RunCtx, opts: IntentScope) {
  if (typeof opts.idempotencyKey !== "string")
    throw new Error("An explicit idempotency key is required.");
  const request = idempotencyOptions(opts.idempotencyKey)!;
  if (opts.customerAccount === undefined) return request;
  if (!opts.userId || !/^acct_[a-zA-Z0-9]+$/.test(opts.customerAccount))
    throw new Error(
      "An authenticated user and V2 customer account are required.",
    );
  const account = await ctx.runQuery(
    componentRef(component, "core/queries/getAccountByStripeId"),
    { stripeAccountId: opts.customerAccount },
  );
  if (!account || account.userId !== opts.userId)
    throw new Error(
      "Customer account does not belong to the authenticated user.",
    );
  return request;
}
export async function createPaymentIntent(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: CreatePaymentIntentOptions,
) {
  const request = await authorize(component, ctx, opts);
  const price = await stripe.prices.retrieve(opts.stripePriceId, {
    expand: ["product"],
  });
  const product = price.product;
  if (
    !price.active ||
    price.type !== "one_time" ||
    !Number.isSafeInteger(price.unit_amount) ||
    price.unit_amount! <= 0 ||
    typeof product === "string" ||
    product.deleted ||
    !product.active
  )
    throw new Error(
      "Payment Intents require an active product and a positive fixed one-time price.",
    );
  const intent = await stripe.paymentIntents.create(
    {
      amount: price.unit_amount!,
      currency: price.currency,
      customer_account: opts.customerAccount,
      receipt_email: opts.receiptEmail,
      ...(opts.paymentMethods === "automatic"
        ? { automatic_payment_methods: { enabled: true } }
        : { allowed_payment_method_types: ["card" as const] }),
      metadata: {
        ...stripReservedMetadata(opts.metadata),
        userId: opts.userId,
        stripePriceId: price.id,
        stripeProductId: product.id,
      },
    },
    request,
  );
  if (!intent.client_secret)
    throw new Error("Stripe did not return a payment secret.");
  return { paymentIntentId: intent.id, clientSecret: intent.client_secret };
}
export async function createSetupIntent(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: CreateSetupIntentOptions,
) {
  if (!opts.customerAccount)
    throw new Error("A customer account is required for setup.");
  const request = await authorize(component, ctx, opts);
  if (opts.consent !== true)
    throw new Error("Explicit saved-card consent is required.");
  if (opts.usage !== "on_session" && opts.usage !== "off_session")
    throw new Error("Unsupported SetupIntent usage.");
  const intent = await stripe.setupIntents.create(
    {
      customer_account: opts.customerAccount,
      usage: opts.usage,
      allowed_payment_method_types: ["card"],
      metadata: {
        ...stripReservedMetadata(opts.metadata),
        userId: opts.userId,
      },
    },
    request,
  );
  if (!intent.client_secret)
    throw new Error("Stripe did not return a setup secret.");
  return { setupIntentId: intent.id, clientSecret: intent.client_secret };
}
