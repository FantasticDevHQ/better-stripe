import type Stripe from "stripe";

import type { RefundStatus } from "../../component/connect/validators.js";
import { throwStripeError } from "../errors.js";
import type { Component, RunCtx } from "../helpers.js";
import type { StripeComponentRefund } from "../types.js";
import { componentRef } from "../webhooks/helpers.js";

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
  _ctx: RunCtx,
  opts: {
    stripePaymentIntentId?: string;
    stripeChargeId?: string;
    amount?: number; // partial refund (cents); omit for full
    reason?: "duplicate" | "fraudulent" | "requested_by_customer";
    metadata?: Record<string, string>;
    stripeAccountId?: string; // refund on a connected account
    /** Return the platform fee pro-rata with the refund. Default true. */
    refundApplicationFee?: boolean;
    /** Reverse the destination transfer pro-rata. Default true. */
    reverseTransfer?: boolean;
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
