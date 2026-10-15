import type Stripe from "stripe";

import type { SplitRecipient } from "../../component/lib/fees.js";
import { computeFee, isPercentOnlyFee, validateSplit } from "../core/fees.js";
import { throwStripeError } from "../errors.js";
import type { Component, RunCtx } from "../helpers.js";
import { stripReservedMetadata } from "../helpers.js";
import type { CheckoutSessionCreateParams } from "../stripe-types.js";
import type { PlatformFeeConfig } from "../types.js";
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
 * Destination and separate charges use platform prices. Catalog accountId is a
 * store attribution tag, not Stripe ownership (createProduct uses the platform).
 * For tagged products, verify the price in the platform Stripe context before
 * rejecting it. Untagged/unknown catalog entries are validated by Checkout.
 */
async function assertPlatformPrice(
  stripe: Stripe,
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
    try {
      await stripe.prices.retrieve(stripePriceId);
    } catch (error) {
      // Only absence on the platform means the ownership check failed.
      // Auth/network/rate-limit failures must not be misreported as ownership.
      if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        error.code !== "resource_missing"
      )
        throw error;
      throwStripeError(
        "INVALID_CONFIGURATION",
        `Price ${stripePriceId} is unavailable on the platform account; destination charges require a platform-owned price.`,
      );
    }
  }
}

// =============================================================================
// Checkout methods
// =============================================================================

export async function renderCheckoutSession(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: {
    idempotencyKey?: string;
    userId: string;
    orgId?: string;
    stripePriceId: string;
    mode: "payment" | "subscription" | "setup";
    uiMode?: "embedded" | "redirect" | "custom" | "form";
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
    /**
     * Platform-default statement-descriptor suffix (BTS-32), used when the
     * destination account record carries no per-store suffix. The caller
     * (BetterStripe) passes its validated configured default.
     */
    defaultStatementDescriptorSuffix?: string;
    metadata?: Record<string, string>;
    sessionOverrides?: Record<string, unknown>;
  },
  capturedDescriptor?: { value?: string },
) {
  const uiMode = opts.uiMode ?? "embedded";

  // Setup-mode sessions create no charge, so routing/fees are meaningless and
  // would persist an unfunded `chargeType` the webhook engine can't act on.
  if (
    opts.mode === "setup" &&
    (opts.split?.length || opts.destinationAccountId || opts.feeConfig)
  ) {
    throwStripeError(
      "INVALID_CONFIGURATION",
      "split/destinationAccountId/fee are not supported for setup-mode Checkout Sessions",
    );
  }

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
  // For subscriptions these live on the subscription and are consumed on each
  // invoice.paid; for one-time payments they live on the PaymentIntent.
  const separateMeta = isSeparate
    ? {
        bsChargeType: "separate",
        bsSplit: JSON.stringify(opts.split),
        ...(opts.feeConfig
          ? { bsFeeConfig: JSON.stringify(opts.feeConfig) }
          : {}),
      }
    : {};

  // Strip the reserved `bs*` namespace from caller metadata so it can't forge
  // webhook instructions (e.g. trigger split transfers without routing).
  const metadata = {
    ...stripReservedMetadata(opts.metadata),
    userId: opts.userId,
    ...(opts.orgId ? { orgId: opts.orgId } : {}),
  };

  // Per-store statement descriptor (BTS-32). Destination charges are platform
  // charges (platform = merchant of record), so buyer recognition is
  // suffix-based: the store's stored suffix, else the configured platform
  // default. Resolved from the component account record at session creation.
  let statementDescriptorSuffix: string | undefined;
  if (destinationAccountId && !isSeparate && opts.mode !== "setup") {
    if (capturedDescriptor)
      statementDescriptorSuffix = capturedDescriptor.value;
    else {
      const account = (await ctx.runQuery(
        componentRef(component, "core/queries/getAccountByStripeId"),
        { stripeAccountId: destinationAccountId },
      )) as { statementDescriptor?: string } | null;
      statementDescriptorSuffix =
        account?.statementDescriptor ?? opts.defaultStatementDescriptorSuffix;
    }
  }

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
      if (statementDescriptorSuffix) {
        // Subscriptions can't carry a suffix directly; the invoice.created
        // processor reads this marker and sets it on each invoice.
        subscriptionData.metadata = {
          ...(subscriptionData.metadata ?? metadata),
          bsStatementDescriptor: statementDescriptorSuffix,
        };
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
      // known; otherwise flag the PI with `bsFeeMode=per_charge` and the webhook
      // collects it at payment_intent.succeeded via a partial reversal of the
      // destination transfer, sized from the amount actually charged (BTS-60).
      paymentIntentData.transfer_data = {
        destination: destinationAccountId,
      };
      if (statementDescriptorSuffix) {
        paymentIntentData.statement_descriptor_suffix =
          statementDescriptorSuffix;
      }
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

  if (uiMode === "embedded" || uiMode === "custom" || uiMode === "form") {
    sessionParams.ui_mode =
      uiMode === "custom"
        ? "elements"
        : uiMode === "form"
          ? "form"
          : "embedded_page";
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
    await assertPlatformPrice(stripe, component, ctx, finalPriceId);
  }

  return {
    version: 1 as const,
    request: finalSessionParams,
    options: opts,
    descriptor: { value: statementDescriptorSuffix },
    routingMetadata: {
      subscription: sessionParams.subscription_data?.metadata,
      payment: sessionParams.payment_intent_data?.metadata,
    },
    row: {
      userId: opts.userId,
      orgId: opts.orgId,
      accountId: opts.accountId,
      priceId: opts.stripePriceId,
      ...feeRow,
      metadata,
    },
  };
}
