import type Stripe from "stripe";

import type { SubscriptionStatus } from "../../component/billing/validators.js";
import type { SplitRecipient } from "../../component/lib/fees.js";
import { isPercentOnlyFee, validateSplit } from "../core/fees.js";
import type { Component, RunCtx } from "../helpers.js";
import {
  epochToIso,
  runMutationOrThrow,
  stripReservedMetadata,
} from "../helpers.js";
import { throwStripeError } from "../errors.js";
import type { PlatformFeeConfig, StripeComponentSubscription } from "../types.js";
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

/**
 * Create a subscription directly (off-checkout) for a V2 buyer
 * (`customer_account`). For a single recipient it routes funds to the seller
 * via `transfer_data.destination` and takes the platform's cut — percent-only
 * fees map to `application_fee_percent`; percent+fixed/tiered fees are flagged
 * (`bsFeeMode=per_invoice`) for per-invoice computation by WEBHOOK_FEE. Persists
 * the subscription + routing/fee fields to the component table.
 */
export async function createSubscription(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: {
    userId: string;
    orgId?: string;
    customerAccount: string;
    stripePriceId: string;
    destinationAccountId?: string;
    /** Multiple recipients; >1 routes via separate charges & transfers. Wins over destinationAccountId. */
    split?: SplitRecipient[];
    feeConfig?: PlatformFeeConfig;
    trialDays?: number;
    /** Platform-default statement-descriptor suffix (BTS-32); see checkout.ts. */
    defaultStatementDescriptorSuffix?: string;
    metadata?: Record<string, string>;
  },
): Promise<{ stripeSubscriptionId: string; status: SubscriptionStatus }> {
  // Resolve routing: a >1 split is separate charges & transfers; a single-recipient
  // split (or destinationAccountId) is a destination charge.
  let isSeparate = false;
  let destinationAccountId = opts.destinationAccountId;
  if (opts.split && opts.split.length > 0) {
    validateSplit(opts.split);
    if (opts.split.length === 1) {
      destinationAccountId = opts.split[0].destinationAccountId;
    } else {
      isSeparate = true;
    }
  }

  // A fee only makes sense when funds are routed; reject the partial config
  // loudly instead of silently creating a plain platform subscription.
  if (opts.feeConfig && !destinationAccountId && !isSeparate) {
    throwStripeError(
      "INVALID_CONFIGURATION",
      "feeConfig requires destinationAccountId or split",
    );
  }

  // Strip the reserved `bs*` namespace from caller metadata (see checkout.ts).
  const metadata: Record<string, string> = {
    ...stripReservedMetadata(opts.metadata),
    userId: opts.userId,
    ...(opts.orgId ? { orgId: opts.orgId } : {}),
  };

  // Per-store statement descriptor (BTS-32): resolved from the destination
  // account's record, falling back to the platform default. Subscriptions
  // can't carry a suffix directly, so it's stashed as a metadata marker the
  // invoice.created processor applies to each invoice.
  let statementDescriptorSuffix: string | undefined;
  if (destinationAccountId && !isSeparate) {
    const account = (await ctx.runQuery(
      componentRef(component, "core/queries/getAccountByStripeId"),
      { stripeAccountId: destinationAccountId },
    )) as { statementDescriptor?: string } | null;
    statementDescriptorSuffix =
      account?.statementDescriptor ?? opts.defaultStatementDescriptorSuffix;
  }

  const params: Stripe.SubscriptionCreateParams = {
    customer_account: opts.customerAccount,
    items: [{ price: opts.stripePriceId }],
    metadata,
  };
  if (opts.trialDays) {
    params.trial_period_days = opts.trialDays;
  }

  const feeRow: {
    chargeType?: "destination" | "separate";
    destinationAccountId?: string;
    applicationFeePercent?: number;
    splitRecipients?: SplitRecipient[];
  } = {};
  if (isSeparate) {
    // Separate charges & transfers: NO transfer_data/application_fee. The split
    // is carried in metadata for the webhook engine to execute.
    params.metadata = {
      ...metadata,
      bsChargeType: "separate",
      bsSplit: JSON.stringify(opts.split),
      ...(opts.feeConfig ? { bsFeeConfig: JSON.stringify(opts.feeConfig) } : {}),
    };
    feeRow.chargeType = "separate";
    feeRow.splitRecipients = opts.split;
  } else if (destinationAccountId) {
    params.transfer_data = { destination: destinationAccountId };
    feeRow.chargeType = "destination";
    feeRow.destinationAccountId = destinationAccountId;
    if (opts.feeConfig) {
      if (isPercentOnlyFee(opts.feeConfig)) {
        params.application_fee_percent = opts.feeConfig.percent;
        feeRow.applicationFeePercent = opts.feeConfig.percent;
      } else {
        params.metadata = {
          ...metadata,
          bsFeeMode: "per_invoice",
          bsFeeConfig: JSON.stringify(opts.feeConfig),
        };
      }
    }
    if (statementDescriptorSuffix) {
      params.metadata = {
        ...(params.metadata ?? metadata),
        bsStatementDescriptor: statementDescriptorSuffix,
      };
    }
  }

  const sub = await callStripe("Failed to create subscription", () =>
    stripe.subscriptions.create(params),
  );

  const firstItem = sub.items?.data?.[0];
  await runMutationOrThrow(
    ctx,
    componentRef(component, "billing/mutations/upsertSubscription"),
    {
      stripeSubscriptionId: sub.id,
      accountId: opts.customerAccount,
      userId: opts.userId,
      orgId: opts.orgId,
      status: sub.status,
      priceId: firstItem?.price?.id ?? opts.stripePriceId,
      quantity: firstItem?.quantity ?? undefined,
      currentPeriodStart: epochToIso(firstItem?.current_period_start ?? undefined),
      currentPeriodEnd: epochToIso(firstItem?.current_period_end ?? undefined),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      canceledAt: epochToIso(sub.canceled_at),
      isTrialing: sub.status === "trialing",
      trialStart: epochToIso(sub.trial_start),
      trialEnd: epochToIso(sub.trial_end),
      ...feeRow,
      metadata: sub.metadata ?? undefined,
    },
  );

  return { stripeSubscriptionId: sub.id, status: sub.status };
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

/** List a buyer's subscriptions scoped to one store (recipient account). */
export async function listSubscriptionsByUserAndStore(
  component: Component,
  ctx: RunCtx,
  opts: { userId: string; destinationAccountId: string; status?: string },
): Promise<StripeComponentSubscription[]> {
  return (await ctx.runQuery(
    componentRef(component, "billing/queries/listSubscriptionsByUserAndStore"),
    opts,
  )) as StripeComponentSubscription[];
}

export async function getActiveSubscription(
  component: Component,
  ctx: RunCtx,
  opts: { userId: string; orgId?: string; destinationAccountId?: string },
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

/**
 * Group a buyer's subscriptions by store (the recipient `destinationAccountId`),
 * preserving first-seen order. Subscriptions with no destination (platform-direct)
 * group under `storeAccountId: null`. The buyer's payment profile is shared across
 * stores; this view separates what they're subscribed to per store (BTS-19).
 */
export function groupSubscriptionsByStore<
  T extends { destinationAccountId?: string },
>(subscriptions: T[]): { storeAccountId: string | null; subscriptions: T[] }[] {
  const order: (string | null)[] = [];
  const groups = new Map<string | null, T[]>();
  for (const sub of subscriptions) {
    const key = sub.destinationAccountId ?? null;
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
      order.push(key);
    }
    bucket.push(sub);
  }
  return order.map((storeAccountId) => ({
    storeAccountId,
    subscriptions: groups.get(storeAccountId)!,
  }));
}
