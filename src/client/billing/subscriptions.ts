import type Stripe from "stripe";

import type { SubscriptionStatus } from "../../component/billing/validators.js";
import type { Component, RunCtx } from "../helpers.js";
import { epochToIso, runMutationOrThrow } from "../helpers.js";
import type { StripeComponentSubscription } from "../types.js";
import { componentRef } from "../webhooks/helpers.js";

// =============================================================================
// Subscription methods
// =============================================================================

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
    await stripe.subscriptions.update(opts.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
  } else {
    await stripe.subscriptions.cancel(opts.stripeSubscriptionId);
  }

  return { success: true };
}

export async function reactivateSubscription(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: { stripeSubscriptionId: string },
) {
  await stripe.subscriptions.update(opts.stripeSubscriptionId, {
    cancel_at_period_end: false,
  });
  return { success: true };
}

export async function updateSubscriptionQuantity(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: { stripeSubscriptionId: string; quantity: number },
) {
  const sub = await stripe.subscriptions.retrieve(opts.stripeSubscriptionId);
  const itemId = sub.items?.data?.[0]?.id;
  if (!itemId) throw new Error("Subscription has no items");
  await stripe.subscriptionItems.update(itemId, { quantity: opts.quantity });
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
