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

/**
 * Map Skool-style evidence categories to Stripe dispute evidence fields (BTS-31),
 * so a seller's UI can collect plain-language fields. Unset categories are
 * omitted. Pass the result as `evidence` to {@link updateDispute}.
 */
export function buildDisputeEvidence(input: {
  /** What the buyer purchased (Stripe: product_description). */
  productDescription?: string;
  /** The buyer's usage/access record (Stripe: access_activity_log). */
  accessActivity?: string;
  /** Off-platform context / anything else (Stripe: uncategorized_text). */
  additionalInfo?: string;
  /** Communications with the buyer (Stripe: customer_communication). */
  customerCommunication?: string;
}): import("stripe").Stripe.DisputeUpdateParams.Evidence {
  return {
    ...(input.productDescription
      ? { product_description: input.productDescription }
      : {}),
    ...(input.accessActivity
      ? { access_activity_log: input.accessActivity }
      : {}),
    ...(input.additionalInfo
      ? { uncategorized_text: input.additionalInfo }
      : {}),
    ...(input.customerCommunication
      ? { customer_communication: input.customerCommunication }
      : {}),
  };
}

/**
 * Compute the evidence-submission countdown for a dispute (BTS-31) from the
 * stored `evidenceDueBy` (ISO). Returns whole days remaining (rounded up) and an
 * overdue flag for the seller's UI. `daysRemaining` is undefined when there's no
 * due date.
 */
export function disputeEvidenceCountdown(
  evidenceDueBy: string | undefined,
  now: Date = new Date(),
): { dueBy?: string; daysRemaining?: number; isOverdue: boolean } {
  if (!evidenceDueBy) return { dueBy: undefined, isOverdue: false };
  const dueMs = new Date(evidenceDueBy).getTime();
  // A malformed/legacy value parses to NaN — fall back cleanly, not NaN days.
  if (Number.isNaN(dueMs)) return { dueBy: undefined, isOverdue: false };
  const diffMs = dueMs - now.getTime();
  return {
    dueBy: evidenceDueBy,
    daysRemaining: Math.ceil(diffMs / 86_400_000),
    isOverdue: diffMs < 0,
  };
}
