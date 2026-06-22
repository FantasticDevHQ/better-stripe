import type Stripe from "stripe";

import type { SubscriptionStatus } from "../../component/billing/validators.js";
import type { Component, RunCtx } from "../helpers.js";
import { epochToIso, runMutationOrThrow } from "../helpers.js";
import { throwStripeError } from "../errors.js";
import type { StripeComponentSubscription } from "../types.js";
import { componentRef } from "../webhooks/helpers.js";

// =============================================================================
// Subscription methods
// =============================================================================

/**
 * Run a Stripe SDK call and surface any failure as a structured
 * `ConvexError<BetterStripeError>` (`STRIPE_API_ERROR`) so it serializes across
 * the Convex action/mutation boundary instead of propagating as a raw `Error`.
 * This is the Plan 006 convention; see `src/client/errors.ts`.
 */
async function callStripe<T>(message: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throwStripeError("STRIPE_API_ERROR", message, err);
  }
}

export async function getSubscription(
  component: Component,
  ctx: RunCtx,
  opts: { subscriptionId: string },
): Promise<StripeComponentSubscription | null> {
  return (await ctx.runQuery(
    componentRef(component, "billing/queries/getSubscription"),
    opts,
  )) as StripeComponentSubscription | null;
}

export async function getSubscriptionByStripeId(
  component: Component,
  ctx: RunCtx,
  opts: { stripeSubscriptionId: string },
): Promise<StripeComponentSubscription | null> {
  return (await ctx.runQuery(
    componentRef(component, "billing/queries/getSubscriptionByStripeId"),
    opts,
  )) as StripeComponentSubscription | null;
}

export async function cancelSubscription(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: { stripeSubscriptionId: string; cancelAtPeriodEnd?: boolean },
) {
  const cancelAtPeriodEnd = opts.cancelAtPeriodEnd ?? true;

  if (cancelAtPeriodEnd) {
    await callStripe("Failed to cancel subscription", () =>
      stripe.subscriptions.update(opts.stripeSubscriptionId, {
        cancel_at_period_end: true,
      }),
    );
  } else {
    await callStripe("Failed to cancel subscription", () =>
      stripe.subscriptions.cancel(opts.stripeSubscriptionId),
    );
  }

  return { success: true };
}

export async function reactivateSubscription(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: { stripeSubscriptionId: string },
) {
  await callStripe("Failed to reactivate subscription", () =>
    stripe.subscriptions.update(opts.stripeSubscriptionId, {
      cancel_at_period_end: false,
    }),
  );
  return { success: true };
}

export async function updateSubscriptionQuantity(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: { stripeSubscriptionId: string; quantity: number },
) {
  const sub = await callStripe("Failed to retrieve subscription", () =>
    stripe.subscriptions.retrieve(opts.stripeSubscriptionId),
  );
  const itemId = sub.items?.data?.[0]?.id;
  if (!itemId) throwStripeError("SUBSCRIPTION_UPDATE_FAILED", "Subscription has no items");
  await callStripe("Failed to update subscription quantity", () =>
    stripe.subscriptionItems.update(itemId, { quantity: opts.quantity }),
  );
  return { success: true };
}

/**
 * Pause collection on a subscription. Sets `pause_collection` (Stripe transitions
 * the subscription to `status: "paused"`); the component DB is updated when the
 * resulting `customer.subscription.updated` webhook arrives.
 */
export async function pauseSubscription(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: {
    stripeSubscriptionId: string;
    behavior?: "keep_as_draft" | "mark_uncollectible" | "void";
    resumesAt?: number; // Unix timestamp
  },
) {
  await callStripe("Failed to pause subscription", () =>
    stripe.subscriptions.update(opts.stripeSubscriptionId, {
      pause_collection: {
        behavior: opts.behavior ?? "keep_as_draft",
        ...(opts.resumesAt !== undefined ? { resumes_at: opts.resumesAt } : {}),
      },
    }),
  );
  return { success: true };
}

/**
 * Resume a paused subscription by clearing `pause_collection`. There is no
 * dedicated Stripe resume endpoint — passing the empty-string sentinel
 * (`Emptyable<PauseCollection>`) clears the field and Stripe returns the
 * subscription to its prior active status.
 */
export async function resumeSubscription(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: { stripeSubscriptionId: string },
) {
  await callStripe("Failed to resume subscription", () =>
    stripe.subscriptions.update(opts.stripeSubscriptionId, {
      // Emptyable<PauseCollection> — "" clears the field.
      pause_collection: "",
    }),
  );
  return { success: true };
}

/**
 * Swap the price on a subscription's first item. Defaults to
 * `proration_behavior: "none"` so the change takes effect without generating
 * proration line items. Operates only on `items.data[0]` (single-item
 * assumption shared with {@link updateSubscriptionQuantity}).
 */
export async function updateSubscriptionPrice(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: {
    stripeSubscriptionId: string;
    stripePriceId: string;
    prorationBehavior?: "always_invoice" | "create_prorations" | "none";
  },
) {
  const sub = await callStripe("Failed to retrieve subscription", () =>
    stripe.subscriptions.retrieve(opts.stripeSubscriptionId),
  );
  const itemId = sub.items?.data?.[0]?.id;
  if (!itemId) throwStripeError("SUBSCRIPTION_UPDATE_FAILED", "Subscription has no items");
  await callStripe("Failed to update subscription price", () =>
    stripe.subscriptions.update(opts.stripeSubscriptionId, {
      items: [{ id: itemId, price: opts.stripePriceId }],
      proration_behavior: opts.prorationBehavior ?? "none",
    }),
  );
  return { success: true };
}

/**
 * Merge the provided keys into the subscription's metadata. Stripe upserts the
 * given keys and preserves any existing keys not included here (pass a key with
 * an empty-string value to delete that key). Fires `customer.subscription.updated`,
 * which syncs `metadata` to the component doc via `upsertSubscriptionFromStripe`.
 */
export async function updateSubscriptionMetadata(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: {
    stripeSubscriptionId: string;
    metadata: Record<string, string>;
  },
) {
  await callStripe("Failed to update subscription metadata", () =>
    stripe.subscriptions.update(opts.stripeSubscriptionId, {
      metadata: opts.metadata,
    }),
  );
  return { success: true };
}

/**
 * Extend or end a subscription's trial. `trialEnd` accepts a Unix timestamp or
 * `"now"` to end the trial immediately.
 */
export async function updateSubscriptionTrialEnd(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: {
    stripeSubscriptionId: string;
    trialEnd: "now" | number; // Unix timestamp or "now" to end immediately
  },
) {
  await callStripe("Failed to update subscription trial end", () =>
    stripe.subscriptions.update(opts.stripeSubscriptionId, {
      trial_end: opts.trialEnd,
    }),
  );
  return { success: true };
}

export async function listSubscriptions(
  component: Component,
  ctx: RunCtx,
  opts?: {
    stripeAccountId?: string;
    status?: SubscriptionStatus;
    limit?: number;
  },
): Promise<StripeComponentSubscription[]> {
  const { stripeAccountId, ...rest } = opts ?? {};
  return (await ctx.runQuery(
    componentRef(component, "billing/queries/listSubscriptions"),
    {
      ...rest,
      ...(stripeAccountId !== undefined ? { accountId: stripeAccountId } : {}),
    },
  )) as StripeComponentSubscription[];
}

export async function listStripeSubscriptions(
  stripe: Stripe,
  _ctx: RunCtx,
  opts?: {
    status?: Stripe.SubscriptionListParams.Status;
    limit?: number;
  },
) {
  const subscriptions: Stripe.Subscription[] = [];

  for await (const subscription of stripe.subscriptions.list({
    status: opts?.status ?? "all",
    limit: opts?.limit ?? 100,
  })) {
    subscriptions.push(subscription);
  }

  return subscriptions;
}

export async function listSubscriptionsByUser(
  component: Component,
  ctx: RunCtx,
  opts: { userId: string; status?: string },
): Promise<StripeComponentSubscription[]> {
  return (await ctx.runQuery(
    componentRef(component, "billing/queries/listSubscriptionsByUser"),
    opts,
  )) as StripeComponentSubscription[];
}

export async function listSubscriptionsByOrg(
  component: Component,
  ctx: RunCtx,
  opts: { orgId: string; status?: string },
): Promise<StripeComponentSubscription[]> {
  return (await ctx.runQuery(
    componentRef(component, "billing/queries/listSubscriptionsByOrg"),
    opts,
  )) as StripeComponentSubscription[];
}

export async function getActiveSubscription(
  component: Component,
  ctx: RunCtx,
  opts: { userId: string; orgId?: string },
): Promise<StripeComponentSubscription | null> {
  return (await ctx.runQuery(
    componentRef(component, "billing/queries/getActiveSubscription"),
    opts,
  )) as StripeComponentSubscription | null;
}

export async function upsertSubscription(
  component: Component,
  ctx: RunCtx,
  opts: {
    stripeSubscriptionId: string;
    accountId?: string;
    userId: string;
    orgId?: string;
    status:
      | "active"
      | "trialing"
      | "past_due"
      | "canceled"
      | "incomplete"
      | "unpaid"
      | "paused";
    priceId?: string;
    quantity?: number;
    currentPeriodStart?: string;
    currentPeriodEnd?: string;
    cancelAtPeriodEnd: boolean;
    canceledAt?: string;
    isTrialing: boolean;
    trialStart?: string;
    trialEnd?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await runMutationOrThrow(
    ctx,
    componentRef(component, "billing/mutations/upsertSubscription"),
    opts,
  );
  return null;
}

export async function getTrialStatus(
  component: Component,
  ctx: RunCtx,
  opts: { subscriptionId: string },
) {
  return ctx.runQuery(
    componentRef(component, "billing/queries/getTrialStatus"),
    opts,
  );
}

// =============================================================================
// Sync
// =============================================================================

export async function syncAllSubscriptions(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
) {
  let synced = 0;
  const errors: string[] = [];

  for await (const sub of stripe.subscriptions.list({
    status: "all",
    limit: 100,
  })) {
    try {
      const metadata = (sub.metadata ?? {}) as Record<string, string>;
      // Returns userId "" when no userId metadata is present (e.g. created in the Stripe Dashboard).
      // "" rows are stored but never matched by user-scoped queries.
      const userId = metadata.userId ?? metadata.user_id ?? "";
      const orgId = metadata.orgId ?? metadata.org_id ?? undefined;

      const firstItem = sub.items?.data?.[0];
      const periodStart = firstItem?.current_period_start ?? undefined;
      const periodEnd = firstItem?.current_period_end ?? undefined;

      await runMutationOrThrow(
        ctx,
        componentRef(component, "billing/mutations/upsertSubscription"),
        {
          stripeSubscriptionId: sub.id,
          accountId:
            typeof sub.customer === "string"
              ? sub.customer
              : (sub.customer?.id ?? ""),
          userId,
          orgId,
          status: sub.status,
          priceId: firstItem?.price?.id ?? undefined,
          quantity: firstItem?.quantity ?? undefined,
          currentPeriodStart: epochToIso(periodStart),
          currentPeriodEnd: epochToIso(periodEnd),
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          canceledAt: epochToIso(sub.canceled_at),
          isTrialing: sub.status === "trialing",
          trialStart: epochToIso(sub.trial_start),
          trialEnd: epochToIso(sub.trial_end),
          metadata: sub.metadata ?? undefined,
        },
      );
      synced++;
    } catch (error) {
      errors.push(
        `Subscription ${sub.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  return { synced, errors, errorCount: errors.length };
}
