import type Stripe from "stripe";

import { getAccountByStripeId } from "../core/accounts.js";
import type { Component, RunCtx } from "../helpers.js";

/** Host-authenticated immutable selectors for an already acknowledged setup. */
export type SetupIntentReadOptions = {
  userId: string;
  customerAccount: string;
  setupIntentId: string;
  usage: "on_session" | "off_session";
};

const observationStatuses = {
  requires_payment_method: true,
  requires_confirmation: true,
  requires_action: true,
  processing: true,
  canceled: true,
  succeeded: true,
};

/** Statuses qualified by the exact SetupIntent reader, independent of Stripe's open union. */
export type SetupIntentObservationStatus = keyof typeof observationStatuses;

function isObservationStatus(
  value: unknown,
): value is SetupIntentObservationStatus {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(observationStatuses, value)
  );
}

export type SetupIntentObservation = {
  setupIntentId: string;
  customerAccount: string;
  usage: "on_session" | "off_session";
  status: SetupIntentObservationStatus;
  /** Present only for an incomplete confirmation. Never persist or log it. */
  clientSecret?: string;
  /** Time of this provider observation, in Unix milliseconds. */
  observedAt: number;
};

function validate(opts: SetupIntentReadOptions) {
  if (
    typeof opts.userId !== "string" ||
    !opts.userId ||
    typeof opts.customerAccount !== "string" ||
    opts.customerAccount.length > 255 ||
    !/^acct_[A-Za-z0-9]+$/.test(opts.customerAccount) ||
    typeof opts.setupIntentId !== "string" ||
    opts.setupIntentId.length > 255 ||
    !/^seti_[A-Za-z0-9]+$/.test(opts.setupIntentId) ||
    (opts.usage !== "on_session" && opts.usage !== "off_session")
  )
    throw new Error("Valid original SetupIntent selectors are required.");
}

/** Exact platform-realm GET only. Host authorization is required before and after I/O. */
export async function getSetupIntentFromStripe(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  input: SetupIntentReadOptions,
): Promise<SetupIntentObservation> {
  const opts = {
    userId: input.userId,
    customerAccount: input.customerAccount,
    setupIntentId: input.setupIntentId,
    usage: input.usage,
  };
  validate(opts);
  const account = await getAccountByStripeId(component, ctx, {
    stripeAccountId: opts.customerAccount,
    requireUnique: true,
  });
  if (
    !account ||
    account.stripeAccountId !== opts.customerAccount ||
    account.userId !== opts.userId
  )
    throw new Error("Original customer account is unavailable.");
  const setup = await stripe.setupIntents.retrieve(opts.setupIntentId);
  if (
    setup.object !== "setup_intent" ||
    setup.id !== opts.setupIntentId ||
    setup.customer_account !== opts.customerAccount ||
    setup.metadata?.userId !== opts.userId ||
    setup.usage !== opts.usage ||
    !isObservationStatus(setup.status)
  )
    throw new Error("SetupIntent does not match the original request.");
  const isIncomplete = [
    "requires_payment_method",
    "requires_confirmation",
    "requires_action",
  ].includes(setup.status);
  const clientSecret = isIncomplete ? setup.client_secret : undefined;
  if (isIncomplete && (typeof clientSecret !== "string" || !clientSecret))
    throw new Error("Incomplete SetupIntent secret is unavailable.");
  return {
    setupIntentId: opts.setupIntentId,
    customerAccount: opts.customerAccount,
    usage: opts.usage,
    status: setup.status,
    ...(typeof clientSecret === "string" ? { clientSecret } : {}),
    observedAt: Date.now(),
  };
}
