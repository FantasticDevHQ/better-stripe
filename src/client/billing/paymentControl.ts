// Server-gated payment control: confirm a payment only when the host's server
// decides it may complete, cancel it when the host's hold ends, read its
// authoritative state, and expire an open Checkout Session.
import type Stripe from "stripe";
import { getAccountByStripeId } from "../core/accounts.js";
import { throwStripeError } from "../errors.js";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow, stripReservedMetadata } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import { getCheckoutSessionByStripeId } from "./checkout.js";
import {
  authorizeIntentScope,
  resolveOneTimePrice,
  type IntentScope,
} from "./intents.js";

const paymentStatuses = {
  requires_payment_method: true,
  requires_confirmation: true,
  requires_action: true,
  processing: true,
  requires_capture: true,
  canceled: true,
  succeeded: true,
};

/** Closed PaymentIntent status union. Unknown provider statuses fail closed. */
export type PaymentIntentStatus = keyof typeof paymentStatuses;

/** Server-priced amount, or a provider price whose economics Stripe supplies. */
export type ServerPaymentEconomics =
  | { amount: number; currency: string; stripePriceId?: never }
  | { stripePriceId: string; amount?: never; currency?: never };

export type ConfirmPaymentIntentOptions = IntentScope &
  ServerPaymentEconomics & {
    /** `ctoken_…` from Stripe.js `createConfirmationToken`. */
    confirmationTokenId: string;
    /**
     * Host deadline, in Unix milliseconds. Checked immediately before the
     * provider request; later calls are refused without contacting Stripe.
     */
    notAfter?: number;
    receiptEmail?: string;
    /** Card-only by default. `automatic` requires `returnUrl` for redirect methods. */
    paymentMethods?: "card" | "automatic";
    returnUrl?: string;
  };

export type PaymentErrorSummary = {
  type: string;
  code?: string;
  declineCode?: string;
  message?: string;
};

export type ServerConfirmedPayment = {
  paymentIntentId: string;
  status: PaymentIntentStatus;
  /**
   * Present only for `requires_action`, so the browser can run
   * `stripe.handleNextAction`. Never persist or log it.
   */
  clientSecret?: string;
  /** Present when the confirmation attempt failed (for example a decline). */
  lastPaymentError?: PaymentErrorSummary;
};

/** Host-authorized selectors of a payment the component created. */
export type PaymentIntentOwnerOptions = {
  userId: string;
  paymentIntentId: string;
  /** When supplied, the V2 buyer account must belong to `userId` and match the payment. */
  customerAccount?: string;
};

export type CancelPaymentIntentOptions = PaymentIntentOwnerOptions & {
  reason?: "abandoned" | "duplicate" | "fraudulent" | "requested_by_customer";
};

export type PaymentCancellation = {
  paymentIntentId: string;
  /**
   * `canceled`: this call cancelled it. `already_canceled`: nothing to do.
   * `succeeded`: it was paid first and was left alone. `not_cancelable`: it is
   * `processing`; Stripe settles it and a later read reports the result.
   */
  outcome: "canceled" | "already_canceled" | "succeeded" | "not_cancelable";
  status: PaymentIntentStatus;
};

export type PaymentIntentState = {
  paymentIntentId: string;
  status: PaymentIntentStatus;
  /** Minor units. */
  amount: number;
  amountReceived: number;
  currency: string;
  customerAccount?: string;
  latestChargeId?: string;
  /** Unix milliseconds. */
  createdAt: number;
  canceledAt?: number;
  cancellationReason?: string;
  lastPaymentError?: PaymentErrorSummary;
  livemode: boolean;
  /** Host metadata. Component attribution (`userId`, `bs*`) is omitted. */
  metadata: Record<string, string>;
  /** Time of this provider observation, in Unix milliseconds. */
  observedAt: number;
};

export type ExpireCheckoutSessionOptions = {
  userId: string;
  stripeSessionId: string;
};

export type CheckoutSessionExpiration = {
  stripeSessionId: string;
  /** `complete`: it was paid or completed first and was left alone. */
  outcome: "expired" | "already_expired" | "complete";
  status: "open" | "complete" | "expired";
  paymentStatus: Stripe.Checkout.Session.PaymentStatus;
};

const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9_]+$/;
const CHECKOUT_SESSION_ID = /^cs_[A-Za-z0-9_]+$/;
const ACCOUNT_ID = /^acct_[A-Za-z0-9]+$/;
const CONFIRMATION_TOKEN_ID = /^ctoken_[A-Za-z0-9_]+$/;
const CURRENCY = /^[a-z]{3}$/;

function qualify(status: unknown): PaymentIntentStatus {
  if (
    typeof status !== "string" ||
    !Object.prototype.hasOwnProperty.call(paymentStatuses, status)
  )
    throw new Error(`Unsupported PaymentIntent status: ${String(status)}.`);
  return status as PaymentIntentStatus;
}

function selector(value: unknown, pattern: RegExp) {
  return (
    typeof value === "string" && value.length <= 255 && pattern.test(value)
  );
}

function errorSummary(
  error: Stripe.PaymentIntent.LastPaymentError | null | undefined,
): PaymentErrorSummary | undefined {
  if (!error) return undefined;
  return {
    type: error.type,
    ...(error.code ? { code: error.code } : {}),
    ...(error.decline_code ? { declineCode: error.decline_code } : {}),
    ...(error.message ? { message: error.message } : {}),
  };
}

function providerError(error: unknown) {
  return (error ?? {}) as {
    type?: string;
    code?: string;
    payment_intent?: Stripe.PaymentIntent;
  };
}

function refuseIfLate(notAfter: number | undefined) {
  if (notAfter !== undefined && Date.now() > notAfter)
    throwStripeError(
      "PAYMENT_CONFIRMATION_REFUSED",
      "The payment deadline has passed. Nothing was charged.",
    );
}

function validateConfirmation(opts: ConfirmPaymentIntentOptions) {
  const hasAmount = opts.amount !== undefined || opts.currency !== undefined;
  const hasPrice = opts.stripePriceId !== undefined;
  if (
    typeof opts.userId !== "string" ||
    !opts.userId ||
    !selector(opts.confirmationTokenId, CONFIRMATION_TOKEN_ID) ||
    hasAmount === hasPrice ||
    (hasAmount &&
      (!Number.isSafeInteger(opts.amount) ||
        opts.amount! <= 0 ||
        typeof opts.currency !== "string" ||
        !CURRENCY.test(opts.currency))) ||
    (hasPrice &&
      (typeof opts.stripePriceId !== "string" || !opts.stripePriceId)) ||
    (opts.notAfter !== undefined && !Number.isFinite(opts.notAfter)) ||
    (opts.paymentMethods !== undefined &&
      opts.paymentMethods !== "card" &&
      opts.paymentMethods !== "automatic") ||
    (opts.paymentMethods === "automatic" && !opts.returnUrl) ||
    (opts.returnUrl !== undefined && typeof opts.returnUrl !== "string")
  )
    throwStripeError(
      "INVALID_CONFIGURATION",
      "Server confirmation needs a user, a confirmation token, either a positive integer amount with a currency or a price, and a return URL for automatic payment methods.",
    );
}

/**
 * Create and confirm a PaymentIntent on the server from a Stripe.js
 * ConfirmationToken. No PaymentIntent or client secret exists before the host
 * decides the payment may proceed, so nothing payable outlives the host's hold.
 */
export async function confirmPaymentIntent(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: ConfirmPaymentIntentOptions,
): Promise<ServerConfirmedPayment> {
  validateConfirmation(opts);
  refuseIfLate(opts.notAfter);
  const request = await authorizeIntentScope(component, ctx, opts);
  const economics =
    opts.stripePriceId !== undefined
      ? await resolveOneTimePrice(stripe, opts.stripePriceId)
      : { amount: opts.amount!, currency: opts.currency! };
  refuseIfLate(opts.notAfter);
  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.create(
      {
        amount: economics.amount,
        currency: economics.currency,
        confirm: true,
        confirmation_token: opts.confirmationTokenId,
        customer_account: opts.customerAccount,
        receipt_email: opts.receiptEmail,
        return_url: opts.returnUrl,
        ...(opts.paymentMethods === "automatic"
          ? { automatic_payment_methods: { enabled: true } }
          : { allowed_payment_method_types: ["card" as const] }),
        metadata: {
          ...stripReservedMetadata(opts.metadata),
          userId: opts.userId,
          ...("stripePriceId" in economics
            ? {
                stripePriceId: economics.stripePriceId,
                stripeProductId: economics.stripeProductId,
              }
            : {}),
        },
      },
      request,
    );
  } catch (error) {
    // A declined confirmation still creates the PaymentIntent. Report it so the
    // host can release or cancel it; no client secret leaves the server.
    const failed = providerError(error);
    const payment = failed.payment_intent;
    if (
      failed.type !== "StripeCardError" ||
      !payment ||
      !selector(payment.id, PAYMENT_INTENT_ID)
    )
      throw error;
    return {
      paymentIntentId: payment.id,
      status: qualify(payment.status),
      ...(payment.last_payment_error
        ? { lastPaymentError: errorSummary(payment.last_payment_error) }
        : {}),
    };
  }
  const status = qualify(intent.status);
  if (status === "requires_action" && !intent.client_secret)
    throw new Error("Stripe did not return a payment secret.");
  return {
    paymentIntentId: intent.id,
    status,
    ...(status === "requires_action"
      ? { clientSecret: intent.client_secret! }
      : {}),
    ...(intent.last_payment_error
      ? { lastPaymentError: errorSummary(intent.last_payment_error) }
      : {}),
  };
}

async function retrieveOwnedPayment(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  input: PaymentIntentOwnerOptions,
) {
  const opts = {
    userId: input.userId,
    paymentIntentId: input.paymentIntentId,
    customerAccount: input.customerAccount,
  };
  if (
    typeof opts.userId !== "string" ||
    !opts.userId ||
    !selector(opts.paymentIntentId, PAYMENT_INTENT_ID) ||
    (opts.customerAccount !== undefined &&
      !selector(opts.customerAccount, ACCOUNT_ID))
  )
    throwStripeError(
      "INVALID_CONFIGURATION",
      "A user and a PaymentIntent ID are required.",
    );
  if (opts.customerAccount !== undefined) {
    const account = await getAccountByStripeId(component, ctx, {
      stripeAccountId: opts.customerAccount,
      requireUnique: true,
    });
    if (
      !account ||
      account.stripeAccountId !== opts.customerAccount ||
      account.userId !== opts.userId
    )
      throwStripeError(
        "PAYMENT_NOT_FOUND",
        "Customer account does not belong to the authenticated user.",
      );
  }
  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.retrieve(opts.paymentIntentId);
  } catch (error) {
    if (providerError(error).code === "resource_missing")
      throwStripeError("PAYMENT_NOT_FOUND", "Payment not found.");
    throw error;
  }
  if (
    intent.id !== opts.paymentIntentId ||
    intent.metadata?.userId !== opts.userId ||
    (opts.customerAccount !== undefined &&
      intent.customer_account !== opts.customerAccount)
  )
    throwStripeError("PAYMENT_NOT_FOUND", "Payment not found.");
  return intent;
}

function observe(intent: Stripe.PaymentIntent): PaymentIntentState {
  const metadata = Object.fromEntries(
    Object.entries(stripReservedMetadata(intent.metadata ?? {})).filter(
      ([key]) => key !== "userId",
    ),
  );
  const charge = intent.latest_charge;
  const lastPaymentError = errorSummary(intent.last_payment_error);
  return {
    paymentIntentId: intent.id,
    status: qualify(intent.status),
    amount: intent.amount,
    amountReceived: intent.amount_received ?? 0,
    currency: intent.currency,
    ...(intent.customer_account
      ? { customerAccount: intent.customer_account }
      : {}),
    ...(charge
      ? { latestChargeId: typeof charge === "string" ? charge : charge.id }
      : {}),
    createdAt: intent.created * 1000,
    ...(intent.canceled_at ? { canceledAt: intent.canceled_at * 1000 } : {}),
    ...(intent.cancellation_reason
      ? { cancellationReason: intent.cancellation_reason }
      : {}),
    ...(lastPaymentError ? { lastPaymentError } : {}),
    livemode: intent.livemode,
    metadata,
    observedAt: Date.now(),
  };
}

/** Live provider state of a payment the component created, for `userId`. */
export async function getPaymentIntentState(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: PaymentIntentOwnerOptions,
): Promise<PaymentIntentState> {
  return observe(await retrieveOwnedPayment(stripe, component, ctx, opts));
}

function settled(
  paymentIntentId: string,
  status: PaymentIntentStatus,
): PaymentCancellation | undefined {
  if (status === "canceled")
    return { paymentIntentId, outcome: "already_canceled", status };
  if (status === "succeeded")
    return { paymentIntentId, outcome: "succeeded", status };
  if (status === "processing")
    return { paymentIntentId, outcome: "not_cancelable", status };
  return undefined;
}

/**
 * Cancel a payment the component created. Idempotent: an already cancelled
 * payment is reported without a provider write, and a payment that succeeded
 * first is never reported as cancelled.
 */
export async function cancelPaymentIntent(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: CancelPaymentIntentOptions,
): Promise<PaymentCancellation> {
  const reason = opts.reason;
  if (
    reason !== undefined &&
    !["abandoned", "duplicate", "fraudulent", "requested_by_customer"].includes(
      reason,
    )
  )
    throwStripeError(
      "INVALID_CONFIGURATION",
      "Unsupported cancellation reason.",
    );
  const intent = await retrieveOwnedPayment(stripe, component, ctx, opts);
  const id = intent.id;
  const before = settled(id, qualify(intent.status));
  if (before) return before;
  try {
    const canceled = await stripe.paymentIntents.cancel(
      id,
      reason ? { cancellation_reason: reason } : {},
    );
    const status = qualify(canceled.status);
    if (status === "canceled")
      return { paymentIntentId: id, outcome: "canceled", status };
    const result = settled(id, status);
    if (!result)
      throwStripeError(
        "STRIPE_API_ERROR",
        `Payment could not be cancelled from ${status}.`,
      );
    return result;
  } catch (error) {
    if (providerError(error).code !== "payment_intent_unexpected_state")
      throw error;
    // It changed state between our read and the cancel (for example the buyer
    // finished authentication). Report what Stripe now says.
    const after = await stripe.paymentIntents.retrieve(id);
    const result = settled(id, qualify(after.status));
    if (!result) throw error;
    return result;
  }
}

/**
 * Expire an open Checkout Session the component created for `userId`.
 * Idempotent; a session that completed first is reported and left alone. The
 * component's checkout row is updated to the provider's status.
 */
export async function expireCheckoutSession(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  input: ExpireCheckoutSessionOptions,
): Promise<CheckoutSessionExpiration> {
  const opts = { userId: input.userId, stripeSessionId: input.stripeSessionId };
  if (
    typeof opts.userId !== "string" ||
    !opts.userId ||
    !selector(opts.stripeSessionId, CHECKOUT_SESSION_ID)
  )
    throwStripeError(
      "INVALID_CONFIGURATION",
      "A user and a Checkout Session ID are required.",
    );
  const row = await getCheckoutSessionByStripeId(component, ctx, {
    stripeSessionId: opts.stripeSessionId,
  });
  if (!row || row.userId !== opts.userId)
    throwStripeError("CHECKOUT_NOT_FOUND", "Checkout Session not found.");
  let session = await stripe.checkout.sessions.retrieve(opts.stripeSessionId);
  if (session.id !== opts.stripeSessionId)
    throwStripeError("CHECKOUT_NOT_FOUND", "Checkout Session not found.");
  let expiredHere = false;
  if (session.status === "open") {
    try {
      session = await stripe.checkout.sessions.expire(opts.stripeSessionId);
      expiredHere = session.status === "expired";
    } catch (error) {
      // It may have completed between our read and the expiry.
      session = await stripe.checkout.sessions.retrieve(opts.stripeSessionId);
      if (session.status === "open") throw error;
    }
  }
  const status = session.status;
  if (status !== "expired" && status !== "complete")
    throwStripeError(
      "STRIPE_API_ERROR",
      `Checkout Session could not be expired from ${String(status)}.`,
    );
  if (row.status !== status)
    await runMutationOrThrow(
      ctx,
      componentRef(component, "billing/mutations/upsertCheckoutSession"),
      {
        stripeSessionId: opts.stripeSessionId,
        userId: row.userId,
        mode: row.mode,
        status,
      },
    );
  return {
    stripeSessionId: opts.stripeSessionId,
    outcome:
      status === "complete"
        ? "complete"
        : expiredHere
          ? "expired"
          : "already_expired",
    status,
    paymentStatus: session.payment_status,
  };
}

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

  /** Create and confirm a payment from a Stripe.js ConfirmationToken. */
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
