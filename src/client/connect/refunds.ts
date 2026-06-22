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
 * Issue a refund via the Stripe API. Provide either `stripePaymentIntentId`
 * (preferred) or `stripeChargeId`. The `refunds` table and the linked
 * `payments` row are updated when the resulting `refund.created` webhook
 * arrives — this returns only the new refund id.
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
    const refund = await stripe.refunds.create(
      {
        ...(opts.stripePaymentIntentId
          ? { payment_intent: opts.stripePaymentIntentId }
          : {}),
        ...(opts.stripeChargeId ? { charge: opts.stripeChargeId } : {}),
        ...(opts.amount !== undefined ? { amount: opts.amount } : {}),
        ...(opts.reason ? { reason: opts.reason } : {}),
        ...(opts.metadata ? { metadata: opts.metadata } : {}),
      },
      opts.stripeAccountId
        ? { stripeAccount: opts.stripeAccountId }
        : undefined,
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
