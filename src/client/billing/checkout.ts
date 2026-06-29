import type Stripe from "stripe";

import type { SplitRecipient } from "../../component/lib/fees.js";
import { computeFee, isPercentOnlyFee, validateSplit } from "../core/fees.js";
import { throwStripeError } from "../errors.js";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import type { CheckoutSessionCreateParams } from "../stripe-types.js";
import type {
  PlatformFeeConfig,
  StripeComponentCheckoutSession,
} from "../types.js";
import { componentRef } from "../webhooks/helpers.js";

/**
 * Derive the persisted fee/routing fields (BTS-11) from the FINAL Checkout
 * Session request, reading the nested `subscription_data`/`payment_intent_data`
 * that will actually be sent to Stripe. Deriving from the final request (rather
 * than a pre-override draft) keeps the stored row consistent when callers pass
 * `sessionOverrides` that replace those nested params.
 */
function deriveFeeRow(params: CheckoutSessionCreateParams): {
  chargeType?: "destination";
  destinationAccountId?: string;
  applicationFeePercent?: number;
  applicationFeeAmount?: number;
} {
  const dest = (d: unknown): string | undefined =>
    typeof d === "string"
      ? d
      : ((d as { id?: string } | null | undefined)?.id ?? undefined);

  if (params.mode === "subscription") {
    const destination = dest(
      params.subscription_data?.transfer_data?.destination,
    );
    if (!destination) return {};
    const pct = params.subscription_data?.application_fee_percent;
    return {
      chargeType: "destination",
      destinationAccountId: destination,
      ...(pct !== undefined ? { applicationFeePercent: pct } : {}),
    };
  }
  if (params.mode === "payment") {
    const destination = dest(
      params.payment_intent_data?.transfer_data?.destination,
    );
    if (!destination) return {};
    const amt = params.payment_intent_data?.application_fee_amount;
    return {
      chargeType: "destination",
      destinationAccountId: destination,
      ...(amt !== undefined ? { applicationFeeAmount: amt } : {}),
    };
  }
  return {};
}

/**
 * Destination charges require the price to live on the PLATFORM account, not a
 * connected account. Best-effort guard: if the price is in the component catalog
 * and its product belongs to a connected account, throw a clear error before
 * hitting Stripe. A price absent from the catalog is left to Stripe to validate.
 */
async function assertPlatformPrice(
  component: Component,
  ctx: RunCtx,
  stripePriceId: string,
): Promise<void> {
  const price = (await ctx.runQuery(
    componentRef(component, "products/queries/getPriceByStripeId"),
    { stripePriceId },
  )) as { stripeProductId?: string } | null;
  if (!price?.stripeProductId) return;

  const product = (await ctx.runQuery(
    componentRef(component, "products/queries/getProductByStripeId"),
    { stripeProductId: price.stripeProductId },
  )) as { accountId?: string } | null;

  if (product?.accountId) {
    throwStripeError(
      "INVALID_CONFIGURATION",
      `Price ${stripePriceId} belongs to connected account ${product.accountId}; destination charges require a platform-owned price.`,
    );
  }
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
    /**
     * Multiple recipients for one sale (store + affiliate[s]). With >1 recipient
     * this routes via separate charges & transfers (no `application_fee`); the
     * transfers are created by the webhook engine. A single-recipient split is
     * treated as a destination charge. Takes precedence over `destinationAccountId`.
     */
    split?: SplitRecipient[];
    /** Resolved platform fee config (the caller resolves override → default). */
    feeConfig?: PlatformFeeConfig;
    /**
     * Charge total in minor units (one-time payment mode). When known, the
     * fixed `application_fee_amount` is computed up front; otherwise the fee is
     * deferred to the webhook.
     */
    amount?: number;
    metadata?: Record<string, string>;
    sessionOverrides?: Record<string, unknown>;
  },
) {
  const uiMode = opts.uiMode ?? "embedded";

  // Resolve the routing model. A `split` with >1 recipient uses separate charges
  // & transfers (no application_fee; webhook engine creates the transfers); a
  // single-recipient split is just a destination charge. `split` wins over
  // `destinationAccountId`.
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
  // Metadata markers the webhook split engine reads to create the transfers.
  const separateMeta = isSeparate
    ? {
        bsChargeType: "separate",
        bsSplit: JSON.stringify(opts.split),
        ...(opts.feeConfig ? { bsFeeConfig: JSON.stringify(opts.feeConfig) } : {}),
      }
    : {};

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

  if (opts.mode === "subscription") {
    const subscriptionData: CheckoutSessionCreateParams["subscription_data"] = {
      metadata,
    };
    if (opts.trialDays) {
      subscriptionData.trial_period_days = opts.trialDays;
    }
    if (isSeparate) {
      // Separate charges & transfers: NO transfer_data / application_fee. The
      // split is carried in metadata for the webhook engine to execute.
      subscriptionData.metadata = { ...metadata, ...separateMeta };
    } else if (destinationAccountId) {
      // Single-recipient destination charge: route funds to the seller and take
      // the platform's cut. Percent-only fees map to `application_fee_percent`;
      // percent+fixed/tiered fees can't be expressed that way, so flag the
      // subscription for per-invoice fee computation (handled by WEBHOOK_FEE).
      subscriptionData.transfer_data = { destination: destinationAccountId };
      if (opts.feeConfig) {
        if (isPercentOnlyFee(opts.feeConfig)) {
          subscriptionData.application_fee_percent = opts.feeConfig.percent;
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
    const paymentIntentData: CheckoutSessionCreateParams["payment_intent_data"] =
      { metadata };
    if (isSeparate) {
      paymentIntentData.metadata = { ...metadata, ...separateMeta };
    } else if (destinationAccountId) {
      // Single-recipient destination charge for a one-time purchase. The platform
      // fee is a fixed `application_fee_amount`: compute it when the amount is
      // known, otherwise defer to the webhook (amount is known at charge time).
      paymentIntentData.transfer_data = {
        destination: destinationAccountId,
      };
      if (opts.feeConfig) {
        if (opts.amount !== undefined) {
          paymentIntentData.application_fee_amount = computeFee(
            opts.amount,
            opts.feeConfig,
          ).feeAmount;
        } else {
          paymentIntentData.metadata = {
            ...metadata,
            bsFeeMode: "per_charge",
            bsFeeConfig: JSON.stringify(opts.feeConfig),
          };
        }
      }
    }
    sessionParams.payment_intent_data = paymentIntentData;
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

  // Merge overrides, then derive the persisted fee/routing row from the FINAL
  // request — sessionOverrides can replace subscription_data/payment_intent_data
  // wholesale, so the row must reflect what was actually sent to Stripe.
  const finalSessionParams: CheckoutSessionCreateParams = {
    ...sessionParams,
    ...(opts.sessionOverrides as Partial<CheckoutSessionCreateParams>),
  };
  // Separate-charge sales persist the split + chargeType directly; single-recipient
  // destination charges derive the row from the final transfer_data/fee.
  const feeRow = isSeparate
    ? { chargeType: "separate" as const, splitRecipients: opts.split }
    : deriveFeeRow(finalSessionParams);

  // Both destination and separate charges run on the platform account, so the
  // price must be platform-owned. Validate the FINAL request (post-overrides) so
  // callers can't inject transfer_data or swap line_items to bypass the check.
  const finalPriceId = finalSessionParams.line_items?.[0]?.price;
  if (
    (isSeparate || feeRow.chargeType === "destination") &&
    typeof finalPriceId === "string"
  ) {
    await assertPlatformPrice(component, ctx, finalPriceId);
  }

  const session = await stripe.checkout.sessions.create(finalSessionParams);

  await runMutationOrThrow(
    ctx,
    componentRef(component, "billing/mutations/upsertCheckoutSession"),
    {
      stripeSessionId: session.id,
      userId: opts.userId,
      orgId: opts.orgId,
      accountId: opts.accountId,
      mode: finalSessionParams.mode,
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
