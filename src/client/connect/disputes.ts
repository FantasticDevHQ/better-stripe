import type Stripe from "stripe";

import type { DisputeStatus } from "../../component/connect/validators.js";
import { throwStripeError } from "../errors.js";
import type { Component, RunCtx } from "../helpers.js";
import type {
  StripeComponentDispute,
  StripeComponentPayment,
} from "../types.js";
import { componentRef } from "../webhooks/helpers.js";
import { type RefundActor, isRefundAuthorized } from "./refundActor.js";

export type { RefundActor } from "./refundActor.js";

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

/**
 * Read a dispute and attach its evidence-submission countdown (BTS-31) — the
 * one-call surface a seller UI needs: `evidenceDueBy` plus days-remaining /
 * overdue. Returns null if the dispute isn't found.
 */
export async function getDisputeWithCountdown(
  component: Component,
  ctx: RunCtx,
  opts: { stripeDisputeId: string; now?: Date },
): Promise<
  | (StripeComponentDispute & {
      countdown: ReturnType<typeof disputeEvidenceCountdown>;
    })
  | null
> {
  const dispute = await getDisputeByStripeId(component, ctx, {
    stripeDisputeId: opts.stripeDisputeId,
  });
  if (!dispute) return null;
  return {
    ...dispute,
    countdown: disputeEvidenceCountdown(dispute.evidenceDueBy, opts.now),
  };
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
 * Submit or stage dispute evidence.
 *
 * ⚠️ Stripe's dispute-update `submit` parameter is documented as DEFAULTING TO
 * TRUE, and submission is effectively one-shot and affects the dispute
 * outcome. To avoid that trap, this method **never omits `submit`**: every
 * call sends an explicit `submit: false` unless the caller passes
 * `submit: true` to finalize and send the response to the bank (BTS-61,
 * BTS-72). So no `updateDispute` call — evidence, metadata, or both — can
 * ever implicitly submit staged evidence.
 *
 * Verified against the Stripe API (test mode, 2026-07-03): an update carrying
 * `evidence` with no `submit` key IS submitted (the documented default), while
 * a metadata-only update with no `submit` key does NOT submit previously
 * staged evidence — and `submit: false` is accepted alongside any update,
 * including on a dispute whose evidence was already submitted (no state
 * change). We still send it explicitly rather than lean on the undocumented
 * metadata-only leniency.
 *
 * Actor scoping (BTS-107): pass `actor` to gate WHO may act on the dispute,
 * mirroring {@link createRefund}. A platform admin may act on any dispute; a
 * seller may act only on a dispute whose sale was routed to their own account.
 * Enforced BEFORE the Stripe call, so an unauthorized submit never reaches the
 * bank. Omit `actor` to preserve the pre-BTS-107 unrestricted behavior.
 */
export async function updateDispute(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: {
    stripeDisputeId: string;
    evidence?: Stripe.DisputeUpdateParams.Evidence;
    metadata?: Record<string, string>;
    submit?: boolean;
    stripeAccountId?: string;
    /**
     * Who is initiating the dispute action (BTS-107). Mirrors {@link RefundActor}:
     * a platform admin (`{ type: "admin" }`) may act on any dispute; a seller
     * (`{ type: "seller", accountId }`) may act only on a dispute for a sale
     * routed to their own account (the destination-charge seller or the split
     * sale's `store` leg). Omit for platform-initiated (unrestricted) actions.
     */
    actor?: RefundActor;
  },
): Promise<{ success: true }> {
  // Actor scoping (BTS-107): enforce BEFORE the Stripe call, so an unauthorized
  // seller can never submit evidence to the bank on another account's dispute.
  await assertDisputeAuthorized(component, ctx, opts);

  // Stage-by-default, on EVERY call: an omitted `submit` must never inherit
  // Stripe's server-side default (documented true). BTS-61 covered the
  // evidence path; BTS-72 extends it to metadata-only updates, so no request
  // shape can implicitly submit staged evidence.
  const submit = opts.submit ?? false;
  try {
    await stripe.disputes.update(
      opts.stripeDisputeId,
      {
        ...(opts.evidence ? { evidence: opts.evidence } : {}),
        ...(opts.metadata ? { metadata: opts.metadata } : {}),
        submit,
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
 *
 * Actor scoping (BTS-107): pass `actor` to gate WHO may concede, mirroring
 * {@link updateDispute} and {@link createRefund}. Enforced BEFORE the Stripe
 * call — conceding is irreversible, so an unauthorized seller must never be
 * able to concede another account's dispute. Omit `actor` for the pre-BTS-107
 * unrestricted behavior.
 */
export async function closeDispute(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: {
    stripeDisputeId: string;
    stripeAccountId?: string;
    /** See {@link updateDispute}'s `actor` (BTS-107). Omit for unrestricted. */
    actor?: RefundActor;
  },
): Promise<{ success: true }> {
  // Actor scoping (BTS-107): enforce BEFORE the (irreversible) concede.
  await assertDisputeAuthorized(component, ctx, opts);

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
 * Enforce dispute-action actor scoping (BTS-107). Resolves the dispute from the
 * component's `disputes` ledger, then the `payments` row it links to (via the
 * dispute's `stripePaymentIntentId`), and rejects a seller-initiated action
 * unless that seller is the sale's merchant — the destination-charge seller or
 * the split sale's `store` leg. Reuses {@link isRefundAuthorized} so refunds
 * and dispute actions can never drift on who owns a sale. Fails closed: a
 * missing dispute, an unlinked dispute (no PaymentIntent), or a missing payment
 * denies a seller rather than allowing them. No-ops for admin / omitted actors.
 */
async function assertDisputeAuthorized(
  component: Component,
  ctx: RunCtx,
  opts: { stripeDisputeId: string; actor?: RefundActor },
): Promise<void> {
  const { actor } = opts;
  if (!actor || actor.type === "admin") return; // unrestricted

  const dispute = await getDisputeByStripeId(component, ctx, {
    stripeDisputeId: opts.stripeDisputeId,
  });
  if (!dispute) {
    throwStripeError(
      "DISPUTE_UNAUTHORIZED",
      `Dispute action not authorized: no dispute found for ${opts.stripeDisputeId} to verify sale ownership`,
    );
  }

  // The dispute row is keyed to its sale by PaymentIntent — the same key that
  // keys the payments ledger. A dispute with no linked PaymentIntent (legacy
  // charge-only) can't be verified, so a seller is denied (fail closed).
  const piId = dispute.stripePaymentIntentId;
  if (!piId) {
    throwStripeError(
      "DISPUTE_UNAUTHORIZED",
      `Dispute action not authorized: dispute ${opts.stripeDisputeId} has no linked PaymentIntent to verify sale ownership`,
    );
  }

  const payment = (await ctx.runQuery(
    componentRef(component, "connect/queries/getPaymentByStripeId"),
    { stripePaymentIntentId: piId },
  )) as StripeComponentPayment | null;
  if (!payment) {
    throwStripeError(
      "DISPUTE_UNAUTHORIZED",
      `Dispute action not authorized: no payment found for ${piId} to verify sale ownership`,
    );
  }

  if (
    !isRefundAuthorized(actor, {
      destinationAccountId: payment.destinationAccountId,
      splitRecipients: payment.splitRecipients,
    })
  ) {
    throwStripeError(
      "DISPUTE_UNAUTHORIZED",
      `Dispute action not authorized: seller ${actor.accountId} may not act on a dispute for a sale routed to another account`,
    );
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
