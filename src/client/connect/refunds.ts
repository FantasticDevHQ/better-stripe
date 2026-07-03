import type Stripe from "stripe";

import type { RefundStatus } from "../../component/connect/validators.js";
import { throwStripeError } from "../errors.js";
import type { Component, RunCtx } from "../helpers.js";
import type { StripeComponentPayment, StripeComponentRefund } from "../types.js";
import { componentRef } from "../webhooks/helpers.js";
import { type RefundActor, isRefundAuthorized } from "./refundActor.js";

export type { RefundActor } from "./refundActor.js";

// =============================================================================
// Refund methods
// =============================================================================

/**
 * Issue a refund via the Stripe API (BTS-34). Provide either
 * `stripePaymentIntentId` (preferred) or `stripeChargeId`.
 *
 * Marketplace semantics, both defaulting ON:
 * - `refundApplicationFee` — return the platform's application fee alongside
 *   the refund (Stripe pro-rates it for partial refunds).
 * - `reverseTransfer` — pull the refunded amount back from the destination
 *   account of a destination charge (Stripe pro-rates partials).
 *
 * If part of the transfer is ALREADY reversed — e.g. the BTS-60 per-charge fee
 * collection (`bs_pcfee_<pi.id>`) — a full refund's proportional reversal
 * would exceed what remains reversible. Live-verified (BTS-66, test mode,
 * 2026-07-03): Stripe does NOT error; it CAPS the refund-driven reversal at
 * the remaining reversible amount, so the transfer ends exactly fully
 * reversed and the refund succeeds. No cap handling is needed here, and the
 * e2e:webhooks money phase pins this behavior.
 *
 * Stripe hard-errors when either flag is sent for a charge that doesn't carry
 * an application fee / a destination transfer, so the charge is resolved first
 * and each flag is only sent when the charge can honour it. Split
 * (separate-charges) sales carry neither — their clawback is webhook-driven
 * transfer math on `refund.created`. The `refunds` table and the linked
 * `payments` row are updated when the resulting webhooks arrive — this
 * returns only the new refund id.
 */
export async function createRefund(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: {
    stripePaymentIntentId?: string;
    stripeChargeId?: string;
    amount?: number; // partial refund (cents); omit for full
    reason?: "duplicate" | "fraudulent" | "requested_by_customer";
    metadata?: Record<string, string>;
    stripeAccountId?: string; // refund on a connected account
    /** Return the platform fee pro-rata with the refund. Default true. */
    refundApplicationFee?: boolean;
    /**
     * Reverse the destination transfer pro-rata. Default true. If the
     * transfer is already partially reversed (BTS-60 fee collection), Stripe
     * caps the reversal at the remainder instead of erroring (BTS-66,
     * live-verified).
     */
    reverseTransfer?: boolean;
    /**
     * Who is initiating the refund (BTS-35). The app authenticates the caller
     * and passes the identity; the library enforces the scope. A platform admin
     * (`{ type: "admin" }`) may refund any sale. A seller
     * (`{ type: "seller", accountId }`) may refund only sales where they are the
     * *merchant*: the destination of a destination charge, or the `store` leg of
     * a split (`separate`-charge) sale. Minor split legs (`affiliate` / `other`
     * commission recipients) are NOT authorized — a full-charge refund unwinds
     * every recipient pro-rata, so those are admin-only. Omit for
     * platform-initiated refunds (unrestricted, back-compatible with BTS-34).
     */
    actor?: RefundActor;
  },
): Promise<{ stripeRefundId: string }> {
  if (!opts.stripePaymentIntentId && !opts.stripeChargeId) {
    throwStripeError(
      "REFUND_CREATE_FAILED",
      "createRefund requires stripePaymentIntentId or stripeChargeId",
    );
  }
  if (opts.stripePaymentIntentId && opts.stripeChargeId) {
    throwStripeError(
      "REFUND_CREATE_FAILED",
      "createRefund accepts stripePaymentIntentId or stripeChargeId, not both",
    );
  }

  // Actor scoping (BTS-35): enforce BEFORE any Stripe call, so an unauthorized
  // seller-initiated refund never moves money. Admins and the (omitted) legacy
  // caller are unrestricted; a seller is checked against where the money was
  // actually routed, read from the component's own payments ledger.
  await assertRefundAuthorized(stripe, component, ctx, opts);

  try {
    const requestOpts = opts.stripeAccountId
      ? { stripeAccount: opts.stripeAccountId }
      : undefined;

    // Resolve the charge to gate the marketplace flags on what it can honour.
    let chargeId = opts.stripeChargeId;
    if (!chargeId && opts.stripePaymentIntentId) {
      const pi = await stripe.paymentIntents.retrieve(
        opts.stripePaymentIntentId,
        undefined,
        requestOpts,
      );
      chargeId =
        typeof pi.latest_charge === "string"
          ? pi.latest_charge
          : (pi.latest_charge?.id ?? undefined);
    }
    const charge = chargeId
      ? await stripe.charges.retrieve(chargeId, undefined, requestOpts)
      : undefined;

    const refundApplicationFee =
      (opts.refundApplicationFee ?? true) && Boolean(charge?.application_fee);
    const reverseTransfer =
      (opts.reverseTransfer ?? true) && Boolean(charge?.transfer);

    const refund = await stripe.refunds.create(
      {
        ...(opts.stripePaymentIntentId
          ? { payment_intent: opts.stripePaymentIntentId }
          : {}),
        ...(opts.stripeChargeId ? { charge: opts.stripeChargeId } : {}),
        ...(opts.amount !== undefined ? { amount: opts.amount } : {}),
        ...(opts.reason ? { reason: opts.reason } : {}),
        ...(opts.metadata ? { metadata: opts.metadata } : {}),
        ...(refundApplicationFee ? { refund_application_fee: true } : {}),
        ...(reverseTransfer ? { reverse_transfer: true } : {}),
      },
      requestOpts,
    );
    return { stripeRefundId: refund.id };
  } catch (err) {
    throwStripeError("REFUND_CREATE_FAILED", "Failed to create refund", err);
  }
}

/**
 * Enforce refund actor scoping (BTS-35). Resolves the payment the refund
 * targets from the component's `payments` ledger and rejects a seller-initiated
 * refund unless that seller is the sale's merchant — the destination-charge
 * seller or the split sale's `store` leg (the `role` is threaded through from
 * the ledger's `splitRecipients`). Affiliate / `other` split legs are denied.
 * Fails closed: if the target payment can't be resolved (no PaymentIntent, or
 * no ledger row), a seller is denied rather than allowed. No-ops for admin /
 * omitted actors.
 */
async function assertRefundAuthorized(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: {
    stripePaymentIntentId?: string;
    stripeChargeId?: string;
    stripeAccountId?: string;
    actor?: RefundActor;
  },
): Promise<void> {
  const { actor } = opts;
  if (!actor || actor.type === "admin") return; // unrestricted

  // Resolve the PaymentIntent id that keys the payments ledger. A charge-only
  // refund resolves through the charge's `payment_intent`.
  const requestOpts = opts.stripeAccountId
    ? { stripeAccount: opts.stripeAccountId }
    : undefined;
  let piId = opts.stripePaymentIntentId;
  if (!piId && opts.stripeChargeId) {
    const charge = await stripe.charges.retrieve(
      opts.stripeChargeId,
      undefined,
      requestOpts,
    );
    piId =
      typeof charge.payment_intent === "string"
        ? charge.payment_intent
        : (charge.payment_intent?.id ?? undefined);
  }
  if (!piId) {
    throwStripeError(
      "REFUND_UNAUTHORIZED",
      "Refund not authorized: cannot verify sale ownership for a charge with no PaymentIntent",
    );
  }

  const payment = (await ctx.runQuery(
    componentRef(component, "connect/queries/getPaymentByStripeId"),
    { stripePaymentIntentId: piId },
  )) as StripeComponentPayment | null;
  if (!payment) {
    throwStripeError(
      "REFUND_UNAUTHORIZED",
      `Refund not authorized: no payment found for ${piId} to verify sale ownership`,
    );
  }

  if (
    !isRefundAuthorized(actor, {
      destinationAccountId: payment.destinationAccountId,
      splitRecipients: payment.splitRecipients,
    })
  ) {
    throwStripeError(
      "REFUND_UNAUTHORIZED",
      `Refund not authorized: seller ${actor.accountId} may not refund a sale routed to another account`,
    );
  }
}

export async function getRefundByStripeId(
  component: Component,
  ctx: RunCtx,
  opts: { stripeRefundId: string },
): Promise<StripeComponentRefund | null> {
  return (await ctx.runQuery(
    componentRef(component, "connect/queries/getRefundByStripeId"),
    opts,
  )) as StripeComponentRefund | null;
}

export async function listRefunds(
  component: Component,
  ctx: RunCtx,
  opts?: {
    stripeAccountId?: string;
    stripePaymentIntentId?: string;
    status?: RefundStatus;
    limit?: number;
  },
): Promise<StripeComponentRefund[]> {
  const { stripeAccountId, ...rest } = opts ?? {};
  return (await ctx.runQuery(
    componentRef(component, "connect/queries/listRefunds"),
    {
      ...rest,
      ...(stripeAccountId !== undefined ? { accountId: stripeAccountId } : {}),
    },
  )) as StripeComponentRefund[];
}
