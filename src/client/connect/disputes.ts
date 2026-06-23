import type Stripe from "stripe";

import type { DisputeStatus } from "../../component/connect/validators.js";
import { throwStripeError } from "../errors.js";
import type { Component, RunCtx } from "../helpers.js";
import type { StripeComponentDispute } from "../types.js";
import { componentRef } from "../webhooks/helpers.js";

// =============================================================================
// Dispute methods
//
// Disputes are created by Stripe (never by the app); the app responds by
// submitting evidence or accepting (closing) the dispute. Component DB state
// is synced from `charge.dispute.*` webhooks — these writes return only an ack.
// =============================================================================

export async function getDisputeByStripeId(
  component: Component,
  ctx: RunCtx,
  opts: { stripeDisputeId: string },
): Promise<StripeComponentDispute | null> {
  return (await ctx.runQuery(
    componentRef(component, "connect/queries/getDisputeByStripeId"),
    opts,
  )) as StripeComponentDispute | null;
}

export async function listDisputes(
  component: Component,
  ctx: RunCtx,
  opts?: {
    stripeAccountId?: string;
    stripePaymentIntentId?: string;
    status?: DisputeStatus;
    limit?: number;
  },
): Promise<StripeComponentDispute[]> {
  const { stripeAccountId, ...rest } = opts ?? {};
  return (await ctx.runQuery(
    componentRef(component, "connect/queries/listDisputes"),
    {
      ...rest,
      ...(stripeAccountId !== undefined ? { accountId: stripeAccountId } : {}),
    },
  )) as StripeComponentDispute[];
}

/**
 * Submit or stage dispute evidence. Set `submit: true` to finalize the
 * response (Stripe submits it for review); omit to save a draft.
 */
export async function updateDispute(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: {
    stripeDisputeId: string;
    evidence?: Stripe.DisputeUpdateParams.Evidence;
    metadata?: Record<string, string>;
    submit?: boolean;
    stripeAccountId?: string;
  },
): Promise<{ success: true }> {
  try {
    await stripe.disputes.update(
      opts.stripeDisputeId,
      {
        ...(opts.evidence ? { evidence: opts.evidence } : {}),
        ...(opts.metadata ? { metadata: opts.metadata } : {}),
        ...(opts.submit !== undefined ? { submit: opts.submit } : {}),
      },
      opts.stripeAccountId
        ? { stripeAccount: opts.stripeAccountId }
        : undefined,
    );
    return { success: true };
  } catch (err) {
    throwStripeError("DISPUTE_UPDATE_FAILED", "Failed to update dispute", err);
  }
}

/**
 * Accept a dispute (concede the chargeback). Irreversible.
 */
export async function closeDispute(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: { stripeDisputeId: string; stripeAccountId?: string },
): Promise<{ success: true }> {
  try {
    await stripe.disputes.close(
      opts.stripeDisputeId,
      {},
      opts.stripeAccountId
        ? { stripeAccount: opts.stripeAccountId }
        : undefined,
    );
    return { success: true };
  } catch (err) {
    throwStripeError("DISPUTE_UPDATE_FAILED", "Failed to close dispute", err);
  }
}
