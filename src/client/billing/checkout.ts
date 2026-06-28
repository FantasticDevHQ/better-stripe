import type Stripe from "stripe";

import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import type { CheckoutSessionCreateParams } from "../stripe-types.js";
import type {
  PlatformFeeConfig,
  StripeComponentCheckoutSession,
} from "../types.js";
import { componentRef } from "../webhooks/helpers.js";

/** True when the fee is a flat percentage Stripe's `application_fee_percent` can express. */
function isPercentOnlyFee(fee: PlatformFeeConfig): boolean {
  return !fee.fixed && (!fee.tiers || fee.tiers.length === 0);
}

// =============================================================================
// Checkout methods
// =============================================================================

export async function createCheckoutSession(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: {
    userId: string;
    orgId?: string;
    stripePriceId: string;
    mode: "payment" | "subscription" | "setup";
    uiMode?: "embedded" | "redirect";
    quantity?: number;
    returnUrl: string;
    trialDays?: number;
    accountId?: string;
    customerEmail?: string;
    /**
     * The seller/recipient connected account funds are routed to (destination
     * charge). Fees only apply when this is set.
     */
    destinationAccountId?: string;
    /** Resolved platform fee config (the caller resolves override → default). */
    feeConfig?: PlatformFeeConfig;
    metadata?: Record<string, string>;
    sessionOverrides?: Record<string, unknown>;
  },
) {
  const uiMode = opts.uiMode ?? "embedded";

  const metadata = {
    ...(opts.metadata ?? {}),
    userId: opts.userId,
    ...(opts.orgId ? { orgId: opts.orgId } : {}),
  };

  const sessionParams: CheckoutSessionCreateParams = {
    mode: opts.mode,
    line_items: [{ price: opts.stripePriceId, quantity: opts.quantity ?? 1 }],
    metadata,
  };

  // Fee/routing denormalized onto the component row (BTS-11 fields).
  const feeRow: {
    chargeType?: "destination";
    destinationAccountId?: string;
    applicationFeePercent?: number;
  } = {};

  if (opts.mode === "subscription") {
    const subscriptionData: CheckoutSessionCreateParams["subscription_data"] = {
      metadata,
    };
    if (opts.trialDays) {
      subscriptionData.trial_period_days = opts.trialDays;
    }
    // Single-recipient destination charge: route funds to the seller and take
    // the platform's cut. Percent-only fees map to `application_fee_percent`;
    // percent+fixed/tiered fees can't be expressed that way, so flag the
    // subscription for per-invoice fee computation (handled by WEBHOOK_FEE).
    if (opts.destinationAccountId) {
      subscriptionData.transfer_data = {
        destination: opts.destinationAccountId,
      };
      feeRow.chargeType = "destination";
      feeRow.destinationAccountId = opts.destinationAccountId;
      if (opts.feeConfig) {
        if (isPercentOnlyFee(opts.feeConfig)) {
          subscriptionData.application_fee_percent = opts.feeConfig.percent;
          feeRow.applicationFeePercent = opts.feeConfig.percent;
        } else {
          subscriptionData.metadata = {
            ...metadata,
            bsFeeMode: "per_invoice",
            bsFeeConfig: JSON.stringify(opts.feeConfig),
          };
        }
      }
    }
    sessionParams.subscription_data = subscriptionData;
  }

  if (opts.mode === "payment") {
    sessionParams.payment_intent_data = { metadata };
  }

  if (uiMode === "embedded") {
    sessionParams.ui_mode = "embedded_page";
    sessionParams.return_url = opts.returnUrl;
  } else {
    sessionParams.success_url = `${opts.returnUrl}?session_id={CHECKOUT_SESSION_ID}`;
    sessionParams.cancel_url = opts.returnUrl;
  }

  if (opts.accountId) {
    sessionParams.customer_account = opts.accountId;
  } else if (opts.customerEmail) {
    sessionParams.customer_email = opts.customerEmail;
  }

  const session = await stripe.checkout.sessions.create({
    ...sessionParams,
    ...(opts.sessionOverrides as Partial<CheckoutSessionCreateParams>),
  });

  await runMutationOrThrow(
    ctx,
    componentRef(component, "billing/mutations/upsertCheckoutSession"),
    {
      stripeSessionId: session.id,
      userId: opts.userId,
      orgId: opts.orgId,
      accountId: opts.accountId,
      mode: opts.mode,
      status: (session.status ?? "open") as "open" | "complete" | "expired",
      clientSecret: session.client_secret ?? undefined,
      url: session.url ?? undefined,
      priceId: opts.stripePriceId,
      ...feeRow,
      metadata,
    },
  );

  return {
    stripeSessionId: session.id,
    clientSecret: session.client_secret ?? undefined,
    url: session.url ?? undefined,
  };
}

export async function getCheckoutSession(
  component: Component,
  ctx: RunCtx,
  opts: { sessionId: string },
): Promise<StripeComponentCheckoutSession | null> {
  return (await ctx.runQuery(
    componentRef(component, "billing/queries/getCheckoutSession"),
    opts,
  )) as StripeComponentCheckoutSession | null;
}

export async function getCheckoutSessionByStripeId(
  component: Component,
  ctx: RunCtx,
  opts: { stripeSessionId: string },
): Promise<StripeComponentCheckoutSession | null> {
  return (await ctx.runQuery(
    componentRef(component, "billing/queries/getCheckoutSessionByStripeId"),
    opts,
  )) as StripeComponentCheckoutSession | null;
}

export async function listCheckoutSessionsByUser(
  component: Component,
  ctx: RunCtx,
  opts: { userId: string; status?: string },
): Promise<StripeComponentCheckoutSession[]> {
  return (await ctx.runQuery(
    componentRef(component, "billing/queries/listCheckoutSessionsByUser"),
    opts,
  )) as StripeComponentCheckoutSession[];
}

export async function upsertCheckoutSession(
  component: Component,
  ctx: RunCtx,
  opts: {
    stripeSessionId: string;
    userId: string;
    orgId?: string;
    accountId?: string;
    mode: "payment" | "subscription" | "setup";
    status: "open" | "complete" | "expired";
    clientSecret?: string;
    url?: string;
    priceId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await runMutationOrThrow(
    ctx,
    componentRef(component, "billing/mutations/upsertCheckoutSession"),
    opts,
  );
  return null;
}

export async function updateCheckoutSession(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: {
    stripeSessionId: string;
    metadata?: Record<string, string>;
  },
) {
  const session = await stripe.checkout.sessions.update(opts.stripeSessionId, {
    metadata: opts.metadata,
  });
  return session;
}
