import { internalActionGeneric, internalMutationGeneric } from "convex/server";
import { v } from "convex/values";
import Stripe from "stripe";

import type { ComponentApi } from "../component/_generated/component.js";
import type {
  InvoiceStatus,
  SubscriptionStatus,
} from "../component/billing/validators.js";
import type {
  DisputeStatus,
  PayoutStatus,
  RefundStatus,
} from "../component/connect/validators.js";
import type { SplitRecipient } from "../component/lib/fees.js";
import * as checkoutImpl from "./billing/checkout.js";
import * as invoicesImpl from "./billing/invoices.js";
import * as subscriptionsImpl from "./billing/subscriptions.js";
import * as disputesImpl from "./connect/disputes.js";
import * as paymentMethodsImpl from "./connect/paymentMethods.js";
import * as payoutsImpl from "./connect/payouts.js";
import * as refundsImpl from "./connect/refunds.js";
import * as transfersImpl from "./connect/transfers.js";
import * as accountLinksImpl from "./core/accountLinks.js";
import * as accountsImpl from "./core/accounts.js";
import * as configImpl from "./core/config.js";
import { resolveFeeConfig, validatePlatformFee } from "./core/fees.js";
import { validateStatementDescriptorSuffix } from "./core/descriptors.js";
export { computeFee, computeSplit } from "./core/fees.js";
export type { FeeBreakdown, SplitResult, SplitTransfer } from "./core/fees.js";
export { groupSubscriptionsByStore } from "./billing/subscriptions.js";
export {
  buildDisputeEvidence,
  disputeEvidenceCountdown,
} from "./connect/disputes.js";
export type { RefundActor } from "./connect/refunds.js";
import type { RefundActor } from "./connect/refunds.js";
export type { AccountBalance } from "./connect/payouts.js";
export type { WedgedReversalClaim } from "./connect/transfers.js";
import type { Component, RunCtx } from "./helpers.js";
import { getStripeClient } from "./helpers.js";
import type {
  V2AccountRetrieveInclude,
  V2AccountUpdateParams,
} from "./stripe-types.js";
import { componentRef, DISPATCHER_UPSERT_PATHS } from "./webhooks/helpers.js";
import * as pricesImpl from "./products/prices.js";
import * as productsImpl from "./products/products.js";
import type {
  AccountLinkWithStatus,
  AsyncHookCtx,
  AsyncHooks,
  BetterStripeOptions,
  FeeOverride,
  PlatformFeeConfig,
  StripeComponentAccount,
  StripeComponentCheckoutSession,
  StripeComponentDispute,
  StripeComponentInvoice,
  StripeComponentPayment,
  StripeComponentPayout,
  StripeComponentPrice,
  StripeComponentProduct,
  StripeComponentRefund,
  StripeComponentSubscription,
  SyncTriggerCtx,
  SyncTriggers,
} from "./types.js";
import type { AsyncHookName, TriggerDispatcherName } from "./types/triggers.js";
import * as dataImpl from "./utils/data.js";
import type { StripeMode } from "./utils/stripeDashboardUrl.js";
import * as webhookEndpointsImpl from "./utils/webhookEndpoints.js";

// Re-export standalone webhook registration
export { registerRoutes } from "./webhooks.js";
export {
  getStripeDashboardUrl,
  isStripeTestMode,
  STRIPE_DASHBOARD_BASE_URL,
  StripeDashboardResourcePath,
} from "./utils/stripeDashboardUrl.js";

// Re-export payment method utilities
export {
  getPaymentMethodCard,
  getPaymentMethodOwner,
} from "./connect/paymentMethodUtils.js";

// Re-export webhook event constants and types
export {
  ALL_BETTER_STRIPE_EVENTS,
  BETTER_STRIPE_V2_WEBHOOK_EVENTS,
  BETTER_STRIPE_WEBHOOK_EVENTS,
} from "./utils/webhookEndpoints.js";
export type {
  BetterStripeV2WebhookEvent,
  BetterStripeWebhookEvent,
} from "./utils/webhookEndpoints.js";

// Re-export types for consumers
export type {
  BetterStripeOptions,
  FeeOverride,
  FeeTier,
  PlatformFeeConfig,
  RegisterRoutesConfig,
} from "./types.js";
export type {
  StripeDashboardResourceType,
  StripeMode,
} from "./utils/stripeDashboardUrl.js";
export type {
  AccountLinkWithStatus,
  AsyncHookCtx,
  AsyncHooks,
  PaymentMethodCard,
  PaymentMethodLike,
  StripeComponentAccount,
  StripeComponentCheckoutSession,
  StripeComponentDispute,
  StripeComponentInvoice,
  StripeComponentPayment,
  StripeComponentPayout,
  StripeComponentPrice,
  StripeComponentProduct,
  StripeComponentRefund,
  StripeComponentSubscription,
  StripeCountrySpecs,
  StripeEventHandler,
  StripeEventHandlers,
  StripeV2Account,
  StripeWebhookEvent,
  SyncTriggerCtx,
  SyncTriggers,
  V2ThinEvent,
  WebhookActionCtx,
} from "./types.js";

export type BetterStripeComponent = ComponentApi;

/** Deep-copy a platform fee config so stored/returned values can't be mutated. */
function clonePlatformFee(config: PlatformFeeConfig): PlatformFeeConfig {
  return {
    ...config,
    tiers: config.tiers?.map((tier) => ({ ...tier })),
  };
}

// =============================================================================
// BETTER STRIPE CLIENT
// =============================================================================

export class BetterStripe {
  public component: Component;
  private _apiKey?: string;
  private _triggers?: SyncTriggers;
  private _hooks?: AsyncHooks;
  private _platformFee?: PlatformFeeConfig;
  private _statementDescriptorSuffix?: string;

  constructor(component: BetterStripeComponent, options?: BetterStripeOptions) {
    this.component = component;
    this._apiKey = options?.STRIPE_SECRET_KEY;
    this._triggers = options?.triggers;
    this._hooks = options?.hooks;
    if (options?.platformFee !== undefined) {
      validatePlatformFee(options.platformFee);
      // Store a defensive copy so later mutation of the caller's object can't
      // silently bypass validation or change runtime behavior.
      this._platformFee = clonePlatformFee(options.platformFee);
    }
    if (options?.statementDescriptorSuffix !== undefined) {
      this._statementDescriptorSuffix = validateStatementDescriptorSuffix(
        options.statementDescriptorSuffix,
      );
    }
  }

  /**
   * The configured default statement-descriptor suffix, if any — the fallback
   * for destination charges to sellers without a per-store suffix (BTS-32).
   */
  get statementDescriptorSuffix(): string | undefined {
    return this._statementDescriptorSuffix;
  }

  /** The configured default platform fee (the platform's take), if any. */
  get platformFee(): PlatformFeeConfig | undefined {
    return this._platformFee && clonePlatformFee(this._platformFee);
  }

  /**
   * Resolve the effective fee config for a charge: per-call override → global
   * default. The fee math itself is applied at charge time (M2).
   */
  resolveFee(override?: FeeOverride): PlatformFeeConfig | undefined {
    const resolved = resolveFeeConfig(this._platformFee, override);
    return resolved && clonePlatformFee(resolved);
  }

  get apiKey(): string {
    const key = this._apiKey;
    if (!key) {
      throw new Error(
        "STRIPE_SECRET_KEY is not set. Pass it via BetterStripe constructor options.",
      );
    }
    return key;
  }

  private stripe(apiVersion?: string): Stripe {
    return getStripeClient(this.apiKey, apiVersion);
  }

  // ============================================================================
  // Static defaults (preserved for backwards compatibility)
  // ============================================================================

  static DEFAULT_ACCOUNT_CONFIGURATION =
    accountsImpl.DEFAULT_ACCOUNT_CONFIGURATION;
  static DEFAULT_ACCOUNT_DEFAULTS = accountsImpl.DEFAULT_ACCOUNT_DEFAULTS;
  static DEFAULT_CUSTOMER_CONFIGURATION =
    accountsImpl.DEFAULT_CUSTOMER_CONFIGURATION;

  // ============================================================================
  // ACCOUNT METHODS
  // ============================================================================

  async createAccount(
    ctx: RunCtx,
    opts: {
      userId: string;
      email?: string;
      name?: string;
      country?: string;
      orgId?: string;
      metadata?: Record<string, string>;
    },
  ) {
    return accountsImpl.createAccount(this.stripe(), this.component, ctx, opts);
  }

  async createAccountWithOnboarding(
    ctx: RunCtx,
    opts: {
      userId: string;
      email?: string;
      name?: string;
      country: string;
      orgId?: string;
      metadata?: Record<string, string>;
      refreshUrl: string;
      returnUrl: string;
      accountConfiguration?: Record<string, unknown>;
      accountDefaults?: Record<string, unknown>;
      dashboard?: "express" | "full" | "none";
    },
  ): Promise<{
    stripeAccountId: string;
    onboardingUrl: string;
  }> {
    return accountsImpl.createAccountWithOnboarding(
      this.stripe(),
      this.component,
      ctx,
      opts,
    );
  }

  async getAccount(
    ctx: RunCtx,
    opts: { accountId: string },
  ): Promise<StripeComponentAccount | null> {
    return accountsImpl.getAccount(this.component, ctx, opts);
  }

  async getOrCreateAccount(
    ctx: RunCtx,
    opts: {
      userId: string;
      email?: string;
      name?: string;
      country?: string;
      orgId?: string;
      metadata?: Record<string, string>;
    },
  ) {
    return accountsImpl.getOrCreateAccount(
      this.stripe(),
      this.component,
      ctx,
      opts,
    );
  }

  async getAccountByUserId(
    ctx: RunCtx,
    opts: { userId: string },
  ): Promise<StripeComponentAccount | null> {
    return accountsImpl.getAccountByUserId(this.component, ctx, opts);
  }

  async getAccountByOrgId(
    ctx: RunCtx,
    opts: { orgId: string },
  ): Promise<StripeComponentAccount | null> {
    return accountsImpl.getAccountByOrgId(this.component, ctx, opts);
  }

  async getAccountByStripeId(
    ctx: RunCtx,
    opts: { stripeAccountId: string },
  ): Promise<StripeComponentAccount | null> {
    return accountsImpl.getAccountByStripeId(this.component, ctx, opts);
  }

  async getAccountOnboardingStatus(ctx: RunCtx, opts: { accountId: string }) {
    return accountsImpl.getAccountOnboardingStatus(this.component, ctx, opts);
  }

  async upsertAccount(
    ctx: RunCtx,
    opts: {
      stripeAccountId: string;
      userId: string;
      orgId?: string;
      email?: string;
      name?: string;
      country?: string;
      capabilities?: Record<string, unknown>;
      requirements?: Record<string, unknown>;
      configuration?: Record<string, unknown>;
      onboardingStatus?: "pending" | "in_progress" | "complete" | "restricted";
      missingRequirements?: string[];
      metadata?: Record<string, unknown>;
    },
  ) {
    return accountsImpl.upsertAccount(this.component, ctx, opts);
  }

  async updateAccount(
    ctx: RunCtx,
    opts: {
      stripeAccountId: string;
      email?: string;
      name?: string;
      metadata?: Record<string, string>;
    },
  ) {
    return accountsImpl.updateAccount(this.stripe(), ctx, opts);
  }

  async getV2Account(
    ctx: RunCtx,
    opts: {
      stripeAccountId: string;
      include?: V2AccountRetrieveInclude[];
    },
  ) {
    return accountsImpl.getV2Account(this.stripe(), ctx, opts);
  }

  async updateV2Account(
    ctx: RunCtx,
    opts: {
      stripeAccountId: string;
      updateParams: V2AccountUpdateParams;
    },
  ) {
    return accountsImpl.updateV2Account(this.stripe(), ctx, opts);
  }

  async listStripeAccounts(ctx: RunCtx, opts?: { limit?: number }) {
    return accountsImpl.listStripeAccounts(this.stripe(), ctx, opts);
  }

  async closeAccount(
    ctx: RunCtx,
    opts: { stripeAccountId: string },
  ): Promise<{ closed: boolean }> {
    return accountsImpl.closeAccount(this.stripe(), this.component, ctx, opts);
  }

  async restartAccountOnboarding(
    ctx: RunCtx,
    opts: { stripeAccountId: string },
  ): Promise<{ closed: boolean }> {
    return accountsImpl.restartAccountOnboarding(
      this.stripe(),
      this.component,
      ctx,
      opts,
    );
  }

  /**
   * Apply the V2 recipient configuration to an existing account, and record
   * the applied configurations on the component account. The account must
   * already exist in the component DB (e.g. from {@link createAccount}).
   */
  async addRecipientConfiguration(
    ctx: RunCtx,
    opts: { stripeAccountId: string },
  ) {
    return accountsImpl.addRecipientConfiguration(
      this.stripe(),
      this.component,
      ctx,
      opts,
    );
  }

  /**
   * Apply the V2 customer configuration to an existing account, making it
   * billable (subscriptions, invoices, billing portal via `customer_account`),
   * and record the applied configurations on the component account. The account
   * must already exist in the component DB (e.g. from {@link createAccount}).
   */
  async addCustomerConfiguration(
    ctx: RunCtx,
    opts: { stripeAccountId: string },
  ) {
    return accountsImpl.addCustomerConfiguration(
      this.stripe(),
      this.component,
      ctx,
      opts,
    );
  }

  /**
   * Store (or clear, with `null`) a per-store statement-descriptor suffix on a
   * seller's account record (BTS-32). Destination charges to that account then
   * show `PLATFORMPREFIX* SUFFIX` on the buyer's card statement. Validated
   * against Stripe's descriptor rules (max 22 chars, at least one letter, no
   * < > \\ ' " *).
   */
  async setAccountStatementDescriptor(
    ctx: RunCtx,
    opts: { stripeAccountId: string; statementDescriptor: string | null },
  ) {
    return accountsImpl.setAccountStatementDescriptor(
      this.component,
      ctx,
      opts,
    );
  }

  /**
   * Ensure a shopper has a V2 account with the `customer` configuration (create
   * if needed), so they can be billed via `customer_account` and later add a
   * merchant/recipient configuration on the same account. Idempotent.
   */
  async ensureCustomerAccount(
    ctx: RunCtx,
    opts: {
      userId: string;
      email?: string;
      name?: string;
      country?: string;
      orgId?: string;
      metadata?: Record<string, string>;
    },
  ) {
    return accountsImpl.ensureCustomerAccount(
      this.stripe(),
      this.component,
      ctx,
      opts,
    );
  }

  // ============================================================================
  // PRODUCT METHODS
  // ============================================================================

  async createProduct(
    ctx: RunCtx,
    opts: {
      name: string;
      description?: string;
      active?: boolean;
      accountId?: string;
      metadata?: Record<string, string>;
    },
  ) {
    return productsImpl.createProduct(this.stripe(), this.component, ctx, {
      ...opts,
      // Stamp the per-store descriptor at create so it covers the first invoice
      // charge (BTS-67); resolves the store's suffix, else this default.
      defaultStatementDescriptorSuffix: this._statementDescriptorSuffix,
    });
  }

  async updateProduct(
    ctx: RunCtx,
    opts: {
      stripeProductId: string;
      name?: string;
      description?: string;
      active?: boolean;
      defaultPrice?: string | null;
      metadata?: Record<string, string>;
    },
  ) {
    return productsImpl.updateProduct(this.stripe(), this.component, ctx, {
      ...opts,
      defaultStatementDescriptorSuffix: this._statementDescriptorSuffix,
    });
  }

  async deactivateProduct(ctx: RunCtx, opts: { stripeProductId: string }) {
    return productsImpl.deactivateProduct(this.stripe(), ctx, opts);
  }

  async getProduct(
    ctx: RunCtx,
    opts: { productId: string },
  ): Promise<StripeComponentProduct | null> {
    return productsImpl.getProduct(this.component, ctx, opts);
  }

  async getProductByStripeId(
    ctx: RunCtx,
    opts: { stripeProductId: string },
  ): Promise<StripeComponentProduct | null> {
    return productsImpl.getProductByStripeId(this.component, ctx, opts);
  }

  async listProducts(
    ctx: RunCtx,
    opts?: { accountId?: string; active?: boolean; limit?: number },
  ): Promise<StripeComponentProduct[]> {
    return productsImpl.listProducts(this.component, ctx, opts);
  }

  async upsertProduct(
    ctx: RunCtx,
    opts: {
      stripeProductId: string;
      accountId?: string;
      name: string;
      description?: string;
      active: boolean;
      metadata?: Record<string, unknown>;
    },
  ) {
    return productsImpl.upsertProduct(this.component, ctx, opts);
  }

  async listStripeProducts(
    ctx: RunCtx,
    opts?: { active?: boolean; limit?: number },
  ) {
    return productsImpl.listStripeProducts(this.stripe(), ctx, opts);
  }

  async deleteProduct(ctx: RunCtx, opts: { stripeProductId: string }) {
    return productsImpl.deleteProduct(this.stripe(), ctx, opts);
  }

  // ============================================================================
  // PRICE METHODS
  // ============================================================================

  async createPrice(
    ctx: RunCtx,
    opts: {
      stripeProductId: string;
      unitAmount: number;
      currency?: string;
      type: "one_time" | "recurring";
      interval?: "day" | "week" | "month" | "year";
      intervalCount?: number;
      nickname?: string;
      metadata?: Record<string, string>;
    },
  ) {
    return pricesImpl.createPrice(this.stripe(), this.component, ctx, opts);
  }

  async updatePrice(
    ctx: RunCtx,
    opts: {
      stripePriceId: string;
      active?: boolean;
      nickname?: string;
      metadata?: Record<string, string>;
    },
  ) {
    return pricesImpl.updatePrice(this.stripe(), ctx, opts);
  }

  async deactivatePrice(ctx: RunCtx, opts: { stripePriceId: string }) {
    return pricesImpl.deactivatePrice(this.stripe(), ctx, opts);
  }

  async getPrice(
    ctx: RunCtx,
    opts: { priceId: string },
  ): Promise<StripeComponentPrice | null> {
    return pricesImpl.getPrice(this.component, ctx, opts);
  }

  async getPriceByStripeId(
    ctx: RunCtx,
    opts: { stripePriceId: string },
  ): Promise<StripeComponentPrice | null> {
    return pricesImpl.getPriceByStripeId(this.component, ctx, opts);
  }

  async listPrices(
    ctx: RunCtx,
    opts?: { productId?: string; active?: boolean; limit?: number },
  ): Promise<StripeComponentPrice[]> {
    return pricesImpl.listPrices(this.component, ctx, opts);
  }

  async listPricesByProduct(
    ctx: RunCtx,
    opts: { stripeProductId: string },
  ): Promise<StripeComponentPrice[]> {
    return pricesImpl.listPricesByProduct(this.component, ctx, opts);
  }

  async upsertPrice(
    ctx: RunCtx,
    opts: {
      stripePriceId: string;
      productId: string;
      stripeProductId: string;
      nickname?: string;
      unitAmount: number;
      currency: string;
      active: boolean;
      type: "one_time" | "recurring";
      interval?: "day" | "week" | "month" | "year";
      intervalCount?: number;
      metadata?: Record<string, unknown>;
    },
  ) {
    return pricesImpl.upsertPrice(this.component, ctx, opts);
  }

  async listStripePrices(
    ctx: RunCtx,
    opts?: { productId?: string; active?: boolean; limit?: number },
  ) {
    return pricesImpl.listStripePrices(this.stripe(), ctx, opts);
  }

  // ============================================================================
  // CHECKOUT METHODS
  // ============================================================================

  async createCheckoutSession(
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
      /** Seller/recipient connected account to route funds to (destination charge). */
      destinationAccountId?: string;
      /** Multiple recipients (store + affiliate[s]); >1 routes via separate charges & transfers. */
      split?: SplitRecipient[];
      /** Per-call platform fee override; falls back to the configured default. */
      fee?: FeeOverride;
      /** Charge total (minor units) for one-time payment fee computation. */
      amount?: number;
      metadata?: Record<string, string>;
      sessionOverrides?: Record<string, unknown>;
    },
  ) {
    const { fee, ...rest } = opts;
    return checkoutImpl.createCheckoutSession(this.stripe(), this.component, ctx, {
      ...rest,
      // Fees apply to destination or split sales; resolve override → default.
      feeConfig:
        opts.destinationAccountId || opts.split?.length
          ? this.resolveFee(fee)
          : undefined,
      defaultStatementDescriptorSuffix: this._statementDescriptorSuffix,
    });
  }

  async getCheckoutSession(
    ctx: RunCtx,
    opts: { sessionId: string },
  ): Promise<StripeComponentCheckoutSession | null> {
    return checkoutImpl.getCheckoutSession(this.component, ctx, opts);
  }

  async getCheckoutSessionByStripeId(
    ctx: RunCtx,
    opts: { stripeSessionId: string },
  ): Promise<StripeComponentCheckoutSession | null> {
    return checkoutImpl.getCheckoutSessionByStripeId(this.component, ctx, opts);
  }

  async listCheckoutSessionsByUser(
    ctx: RunCtx,
    opts: { userId: string; status?: string },
  ): Promise<StripeComponentCheckoutSession[]> {
    return checkoutImpl.listCheckoutSessionsByUser(this.component, ctx, opts);
  }

  async upsertCheckoutSession(
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
    return checkoutImpl.upsertCheckoutSession(this.component, ctx, opts);
  }

  async updateCheckoutSession(
    ctx: RunCtx,
    opts: {
      stripeSessionId: string;
      metadata?: Record<string, string>;
    },
  ) {
    return checkoutImpl.updateCheckoutSession(this.stripe(), ctx, opts);
  }

  // ============================================================================
  // SUBSCRIPTION METHODS
  // ============================================================================

  /**
   * Create a subscription directly for a V2 buyer (`customer_account`), off the
   * checkout flow. With a `destinationAccountId` it routes funds to the seller
   * and takes the platform fee (override → configured default).
   */
  async createSubscription(
    ctx: RunCtx,
    opts: {
      userId: string;
      orgId?: string;
      customerAccount: string;
      stripePriceId: string;
      destinationAccountId?: string;
      /** Multiple recipients (store + affiliate[s]); >1 routes via separate charges & transfers. */
      split?: SplitRecipient[];
      fee?: FeeOverride;
      trialDays?: number;
      metadata?: Record<string, string>;
    },
  ) {
    const { fee, ...rest } = opts;
    return subscriptionsImpl.createSubscription(this.stripe(), this.component, ctx, {
      ...rest,
      feeConfig:
        opts.destinationAccountId || opts.split?.length
          ? this.resolveFee(fee)
          : undefined,
      defaultStatementDescriptorSuffix: this._statementDescriptorSuffix,
    });
  }

  async getSubscription(
    ctx: RunCtx,
    opts: { subscriptionId: string },
  ): Promise<StripeComponentSubscription | null> {
    return subscriptionsImpl.getSubscription(this.component, ctx, opts);
  }

  async getSubscriptionByStripeId(
    ctx: RunCtx,
    opts: { stripeSubscriptionId: string },
  ): Promise<StripeComponentSubscription | null> {
    return subscriptionsImpl.getSubscriptionByStripeId(
      this.component,
      ctx,
      opts,
    );
  }

  async cancelSubscription(
    ctx: RunCtx,
    opts: { stripeSubscriptionId: string; cancelAtPeriodEnd?: boolean },
  ) {
    return subscriptionsImpl.cancelSubscription(this.stripe(), ctx, opts);
  }

  async reactivateSubscription(
    ctx: RunCtx,
    opts: { stripeSubscriptionId: string },
  ) {
    return subscriptionsImpl.reactivateSubscription(this.stripe(), ctx, opts);
  }

  async updateSubscriptionQuantity(
    ctx: RunCtx,
    opts: { stripeSubscriptionId: string; quantity: number },
  ) {
    return subscriptionsImpl.updateSubscriptionQuantity(
      this.stripe(),
      ctx,
      opts,
    );
  }

  async pauseSubscription(
    ctx: RunCtx,
    opts: {
      stripeSubscriptionId: string;
      behavior?: "keep_as_draft" | "mark_uncollectible" | "void";
      resumesAt?: number;
    },
  ) {
    return subscriptionsImpl.pauseSubscription(this.stripe(), ctx, opts);
  }

  async resumeSubscription(
    ctx: RunCtx,
    opts: { stripeSubscriptionId: string },
  ) {
    return subscriptionsImpl.resumeSubscription(this.stripe(), ctx, opts);
  }

  async updateSubscriptionPrice(
    ctx: RunCtx,
    opts: {
      stripeSubscriptionId: string;
      stripePriceId: string;
      prorationBehavior?: "always_invoice" | "create_prorations" | "none";
    },
  ) {
    return subscriptionsImpl.updateSubscriptionPrice(this.stripe(), ctx, opts);
  }

  async updateSubscriptionMetadata(
    ctx: RunCtx,
    opts: { stripeSubscriptionId: string; metadata: Record<string, string> },
  ) {
    return subscriptionsImpl.updateSubscriptionMetadata(
      this.stripe(),
      ctx,
      opts,
    );
  }

  async updateSubscriptionTrialEnd(
    ctx: RunCtx,
    opts: { stripeSubscriptionId: string; trialEnd: "now" | number },
  ) {
    return subscriptionsImpl.updateSubscriptionTrialEnd(
      this.stripe(),
      ctx,
      opts,
    );
  }

  async listSubscriptions(
    ctx: RunCtx,
    opts?: {
      stripeAccountId?: string;
      status?: SubscriptionStatus;
      limit?: number;
    },
  ): Promise<StripeComponentSubscription[]> {
    return subscriptionsImpl.listSubscriptions(this.component, ctx, opts);
  }

  async listStripeSubscriptions(
    ctx: RunCtx,
    opts?: {
      status?: Stripe.SubscriptionListParams.Status;
      limit?: number;
    },
  ) {
    return subscriptionsImpl.listStripeSubscriptions(this.stripe(), ctx, opts);
  }

  async listSubscriptionsByUser(
    ctx: RunCtx,
    opts: { userId: string; status?: string },
  ): Promise<StripeComponentSubscription[]> {
    return subscriptionsImpl.listSubscriptionsByUser(this.component, ctx, opts);
  }

  async listSubscriptionsByOrg(
    ctx: RunCtx,
    opts: { orgId: string; status?: string },
  ): Promise<StripeComponentSubscription[]> {
    return subscriptionsImpl.listSubscriptionsByOrg(this.component, ctx, opts);
  }

  /** List a buyer's subscriptions scoped to one store (recipient account). */
  async listSubscriptionsByUserAndStore(
    ctx: RunCtx,
    opts: { userId: string; destinationAccountId: string; status?: string },
  ): Promise<StripeComponentSubscription[]> {
    return subscriptionsImpl.listSubscriptionsByUserAndStore(
      this.component,
      ctx,
      opts,
    );
  }

  async getActiveSubscription(
    ctx: RunCtx,
    opts: { userId: string; orgId?: string; destinationAccountId?: string },
  ): Promise<StripeComponentSubscription | null> {
    return subscriptionsImpl.getActiveSubscription(this.component, ctx, opts);
  }

  async upsertSubscription(
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
    return subscriptionsImpl.upsertSubscription(this.component, ctx, opts);
  }

  async getTrialStatus(ctx: RunCtx, opts: { subscriptionId: string }) {
    return subscriptionsImpl.getTrialStatus(this.component, ctx, opts);
  }

  // ============================================================================
  // INVOICE METHODS
  // ============================================================================

  async listInvoices(
    ctx: RunCtx,
    opts?: {
      stripeAccountId?: string;
      userId?: string;
      subscriptionId?: string;
      status?: string;
      limit?: number;
    },
  ): Promise<StripeComponentInvoice[]> {
    return invoicesImpl.listInvoices(this.component, ctx, opts);
  }

  async listInvoicesByUser(ctx: RunCtx, opts: { userId: string }) {
    return invoicesImpl.listInvoicesByUser(this.component, ctx, opts);
  }

  async getInvoice(
    ctx: RunCtx,
    opts: { stripeInvoiceId: string },
  ): Promise<StripeComponentInvoice | null> {
    return invoicesImpl.getInvoice(this.component, ctx, opts);
  }

  async getInvoiceByStripeId(
    ctx: RunCtx,
    opts: { stripeInvoiceId: string },
  ): Promise<StripeComponentInvoice | null> {
    return invoicesImpl.getInvoice(this.component, ctx, opts);
  }

  async upsertInvoice(
    ctx: RunCtx,
    opts: {
      stripeInvoiceId: string;
      userId: string;
      orgId?: string;
      accountId?: string;
      subscriptionId?: string;
      status: InvoiceStatus;
      currency: string;
      amountDue: number;
      amountPaid: number;
      hostedInvoiceUrl?: string;
      invoicePdf?: string;
      periodStart?: string;
      periodEnd?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    return invoicesImpl.upsertInvoice(this.component, ctx, opts);
  }

  async getPublishableKey(ctx: RunCtx): Promise<string | null> {
    return configImpl.getPublishableKey(this.component, ctx);
  }

  async getStripeMode(ctx: RunCtx): Promise<StripeMode> {
    return configImpl.getStripeMode(this.component, ctx);
  }

  async getInvoiceFromStripe(ctx: RunCtx, opts: { stripeInvoiceId: string }) {
    return invoicesImpl.getInvoiceFromStripe(this.stripe(), ctx, opts);
  }

  // ============================================================================
  // PAYMENT METHOD METHODS
  // ============================================================================

  async listPaymentMethods(
    ctx: RunCtx,
    opts: { stripeCustomerId: string; type?: string },
  ) {
    return paymentMethodsImpl.listPaymentMethods(this.stripe(), ctx, opts);
  }

  async getPaymentMethod(ctx: RunCtx, opts: { paymentMethodId: string }) {
    return paymentMethodsImpl.getPaymentMethod(this.stripe(), ctx, opts);
  }

  async attachPaymentMethod(
    ctx: RunCtx,
    opts: { paymentMethodId: string; stripeCustomerId: string },
  ) {
    return paymentMethodsImpl.attachPaymentMethod(this.stripe(), ctx, opts);
  }

  async detachPaymentMethod(ctx: RunCtx, opts: { paymentMethodId: string }) {
    return paymentMethodsImpl.detachPaymentMethod(this.stripe(), ctx, opts);
  }

  async setDefaultPaymentMethod(
    ctx: RunCtx,
    opts: { stripeAccountId: string; paymentMethodId: string },
  ) {
    return paymentMethodsImpl.setDefaultPaymentMethod(this.stripe(), ctx, opts);
  }

  // ============================================================================
  // ACCOUNT LINK METHODS
  // ============================================================================

  async createAccountLink(
    ctx: RunCtx,
    opts: {
      stripeAccountId: string;
      refreshUrl: string;
      returnUrl: string;
      type: "account_onboarding" | "account_update";
    },
  ) {
    return accountLinksImpl.createAccountLink(this.stripe(), ctx, opts);
  }

  async createV2AccountLink(
    ctx: RunCtx,
    opts: {
      stripeAccountId: string;
      type: "account_onboarding" | "account_update";
      refreshUrl: string;
      returnUrl: string;
      configurations?: string[];
    },
  ) {
    return accountLinksImpl.createV2AccountLink(this.stripe(), ctx, opts);
  }

  async createAccountSession(
    ctx: RunCtx,
    opts: {
      stripeAccountId: string;
      components: Stripe.AccountSessionCreateParams.Components;
    },
  ) {
    return accountLinksImpl.createAccountSession(this.stripe(), ctx, opts);
  }

  /**
   * Client secret for a seller's embedded disputes surface (disputes_list +
   * payment_disputes), so they can view and respond to their own disputes.
   */
  async createDisputeSession(ctx: RunCtx, opts: { stripeAccountId: string }) {
    return accountLinksImpl.createDisputeSession(this.stripe(), ctx, opts);
  }

  async createLoginLink(ctx: RunCtx, opts: { stripeAccountId: string }) {
    return accountLinksImpl.createLoginLink(this.stripe(), ctx, opts);
  }

  async getAccountLinkWithStatus(
    ctx: RunCtx,
    opts: {
      stripeAccountId: string;
      refreshUrl: string;
      returnUrl: string;
    },
  ): Promise<AccountLinkWithStatus> {
    return accountLinksImpl.getAccountLinkWithStatus(this.stripe(), ctx, opts);
  }

  async createBillingPortalSession(
    ctx: RunCtx,
    opts: { stripeAccountId: string; returnUrl: string },
  ) {
    return accountLinksImpl.createBillingPortalSession(
      this.stripe(),
      ctx,
      opts,
    );
  }

  async getCountrySpecs(ctx: RunCtx, opts: { countryCode: string }) {
    return accountLinksImpl.getCountrySpecs(this.stripe(), ctx, opts);
  }

  // ============================================================================
  // PAYOUT METHODS
  // ============================================================================

  async createPayout(
    ctx: RunCtx,
    opts: {
      stripeAccountId: string;
      amount: number;
      currency?: string;
      metadata?: Record<string, string>;
    },
  ) {
    return payoutsImpl.createPayout(this.stripe(), ctx, opts);
  }

  /**
   * Reverse the transfers funded by a charge (pro-rata by `percent`, a total
   * `amount`, or in full). The reversal primitive behind dispute clawback and
   * refunds; idempotent and ledger-tracked.
   */
  async reverseTransfers(
    ctx: RunCtx,
    opts: { sourceChargeId: string; percent?: number; amount?: number },
  ) {
    return transfersImpl.reverseTransfers(this.stripe(), this.component, ctx, opts);
  }

  /**
   * List "wedged" reversal legs (BTS-74): legs whose reversal claim frontier is
   * stuck ahead of the confirmed reversed amount because the claiming operation
   * died permanently, blocking every successor on that leg. An ops diagnostic;
   * feed a returned `operationId` into {@link reclaimReversalClaim} to resolve it.
   */
  async listWedgedReversalClaims(ctx: RunCtx) {
    return transfersImpl.listWedgedReversalClaims(this.component, ctx);
  }

  /**
   * Resolve a permanently-dead reversal claim (BTS-74). `mode: "reexecute"`
   * (default) replays the recorded reversal under its original idempotency keys
   * to fill the hole and unblock successors; `mode: "release"` abandons the
   * claim after verifying (via the >24h idempotency window and live Stripe
   * `amount_reversed`) that the money never moved. Re-execution is the safe
   * default; release is for claims proven dead.
   */
  async reclaimReversalClaim(
    ctx: RunCtx,
    opts: {
      operationId: string;
      mode?: "reexecute" | "release";
      minAgeMs?: number;
      now?: number;
    },
  ) {
    return transfersImpl.reclaimReversalClaim(
      this.stripe(),
      this.component,
      ctx,
      opts,
    );
  }

  /**
   * The original split legs of one sale (reinstatement rows excluded) — the
   * read behind the `useSplitBreakdown` hook / per-sale breakdown UIs.
   */
  async listTransfersByCharge(
    ctx: RunCtx,
    opts: { sourceChargeId: string; limit?: number },
  ) {
    return transfersImpl.listTransfersByCharge(this.component, ctx, opts);
  }

  /**
   * A recipient's transfer ledger (the earnings view — includes reinstatements)
   * — the read behind the `useEarnings` hook.
   */
  async listTransfersByAccount(
    ctx: RunCtx,
    opts: { destinationAccountId: string; limit?: number },
  ) {
    return transfersImpl.listTransfersByAccount(this.component, ctx, opts);
  }

  /**
   * Retrieve a connected account's balance (BTS-65), scoped to that account via
   * the `Stripe-Account` header. Returns one `AccountBalance`
   * (`{ available, pending, currency }`, minor units) per currency — each entry
   * feeds the headless `PayoutSchedule` component's `balance` prop directly.
   */
  async getAccountBalance(_ctx: RunCtx, opts: { stripeAccountId: string }) {
    return payoutsImpl.getAccountBalance(this.stripe(), opts);
  }

  async getPayout(ctx: RunCtx, opts: { payoutId: string }) {
    return payoutsImpl.getPayout(this.component, ctx, opts);
  }

  async listPayouts(
    ctx: RunCtx,
    opts?: { stripeAccountId?: string; status?: PayoutStatus; limit?: number },
  ) {
    return payoutsImpl.listPayouts(this.component, ctx, opts);
  }

  // ============================================================================
  // REFUND METHODS
  // ============================================================================

  /**
   * Issue a refund (BTS-34). `refundApplicationFee` and `reverseTransfer`
   * default true: the platform fee is returned and the destination transfer
   * reversed pro-rata (Stripe-native for partials) — each sent only when the
   * charge actually carries a fee / transfer. Split sales are clawed back by
   * the `refund.created` webhook's transfer math instead. A transfer already
   * partially reversed by the BTS-60 fee collection is safe to fully refund:
   * Stripe caps the reversal at the remainder instead of erroring (BTS-66,
   * live-verified). See {@link refundsImpl.createRefund}.
   */
  async createRefund(
    ctx: RunCtx,
    opts: {
      stripePaymentIntentId?: string;
      stripeChargeId?: string;
      amount?: number;
      reason?: "duplicate" | "fraudulent" | "requested_by_customer";
      metadata?: Record<string, string>;
      stripeAccountId?: string;
      refundApplicationFee?: boolean;
      reverseTransfer?: boolean;
      /**
       * Who is initiating the refund (BTS-35). A platform admin may refund any
       * sale; a seller may refund only sales routed to their own account. Omit
       * for platform-initiated (unrestricted) refunds.
       */
      actor?: RefundActor;
    },
  ): Promise<{ stripeRefundId: string }> {
    return refundsImpl.createRefund(this.stripe(), this.component, ctx, opts);
  }

  async getRefundByStripeId(
    ctx: RunCtx,
    opts: { stripeRefundId: string },
  ): Promise<StripeComponentRefund | null> {
    return refundsImpl.getRefundByStripeId(this.component, ctx, opts);
  }

  async listRefunds(
    ctx: RunCtx,
    opts?: {
      stripeAccountId?: string;
      stripePaymentIntentId?: string;
      status?: RefundStatus;
      limit?: number;
    },
  ): Promise<StripeComponentRefund[]> {
    return refundsImpl.listRefunds(this.component, ctx, opts);
  }

  // ============================================================================
  // DISPUTE METHODS
  // ============================================================================

  async getDisputeByStripeId(
    ctx: RunCtx,
    opts: { stripeDisputeId: string },
  ): Promise<StripeComponentDispute | null> {
    return disputesImpl.getDisputeByStripeId(this.component, ctx, opts);
  }

  /**
   * Read a dispute with its evidence-submission countdown (evidenceDueBy +
   * days-remaining/overdue) — the seller UI's deadline surface (BTS-31).
   */
  async getDisputeWithCountdown(
    ctx: RunCtx,
    opts: { stripeDisputeId: string; now?: Date },
  ) {
    return disputesImpl.getDisputeWithCountdown(this.component, ctx, opts);
  }

  async listDisputes(
    ctx: RunCtx,
    opts?: {
      stripeAccountId?: string;
      stripePaymentIntentId?: string;
      status?: DisputeStatus;
      limit?: number;
    },
  ): Promise<StripeComponentDispute[]> {
    return disputesImpl.listDisputes(this.component, ctx, opts);
  }

  /**
   * Submit or stage dispute evidence. Stripe's `submit` defaults to TRUE, so
   * this method stages by default: EVERY call sends an explicit
   * `submit: false` — evidence-bearing or metadata-only — unless you pass
   * `submit: true` to submit to the bank (one-shot, outcome-affecting;
   * BTS-61, BTS-72). See {@link disputesImpl.updateDispute}.
   */
  async updateDispute(
    ctx: RunCtx,
    opts: {
      stripeDisputeId: string;
      evidence?: Stripe.DisputeUpdateParams.Evidence;
      metadata?: Record<string, string>;
      submit?: boolean;
      stripeAccountId?: string;
    },
  ): Promise<{ success: true }> {
    return disputesImpl.updateDispute(this.stripe(), ctx, opts);
  }

  async closeDispute(
    ctx: RunCtx,
    opts: { stripeDisputeId: string; stripeAccountId?: string },
  ): Promise<{ success: true }> {
    return disputesImpl.closeDispute(this.stripe(), ctx, opts);
  }

  // ============================================================================
  // WEBHOOK ENDPOINT MANAGEMENT
  // ============================================================================

  async listWebhookEndpoints(ctx: RunCtx, opts?: { limit?: number }) {
    return webhookEndpointsImpl.listWebhookEndpoints(this.stripe(), ctx, opts);
  }

  async createWebhookEndpoint(
    ctx: RunCtx,
    opts: {
      url: string;
      description?: string;
      enabledEvents?: string[];
    },
  ): Promise<{ id: string; secret: string; url: string }> {
    return webhookEndpointsImpl.createWebhookEndpoint(this.stripe(), ctx, opts);
  }

  async listEventDestinations(ctx: RunCtx, opts?: { limit?: number }) {
    return webhookEndpointsImpl.listEventDestinations(this.stripe(), ctx, opts);
  }

  async setupEventDestination(
    ctx: RunCtx,
    opts: {
      url: string;
      name?: string;
      description?: string;
      enabledEvents?: string[];
      eventPayload?: "snapshot" | "thin";
    },
  ): Promise<{
    id: string;
    secret: string;
    url: string;
    enabledEvents: string[];
    created: boolean;
  }> {
    return webhookEndpointsImpl.setupEventDestination(this.stripe(), ctx, opts);
  }

  // ============================================================================
  // WEBHOOK EVENT QUERIES
  // ============================================================================

  async listWebhookEvents(
    ctx: RunCtx,
    opts?: { eventType?: string; status?: string; limit?: number },
  ) {
    return (await ctx.runQuery(
      componentRef(this.component, "webhooks/queries/listWebhookEvents"),
      opts ?? {},
    )) as Array<{
      _id: string;
      _creationTime: number;
      stripeEventId: string;
      eventType: string;
      livemode?: boolean;
      processedAt: number;
      status: "pending" | "processed" | "failed";
      lastError?: string;
    }>;
  }

  // ============================================================================
  // DATA MANAGEMENT
  // ============================================================================

  async clearAll(ctx: RunCtx): Promise<{ cleared: number; tables: string[] }> {
    return dataImpl.clearAll(this.component, ctx);
  }

  // ============================================================================
  // SYNC METHODS
  // ============================================================================

  async syncAllAccounts(ctx: RunCtx) {
    return accountsImpl.syncAllAccounts(this.stripe(), this.component, ctx);
  }

  async syncAllProducts(ctx: RunCtx) {
    return productsImpl.syncAllProducts(this.stripe(), this.component, ctx);
  }

  async syncAllSubscriptions(ctx: RunCtx) {
    return subscriptionsImpl.syncAllSubscriptions(
      this.stripe(),
      this.component,
      ctx,
    );
  }

  // ============================================================================
  // WEBHOOK HANDLER EXPORT (BetterAuth-style)
  // ============================================================================

  /**
   * Build the two webhook handler function definitions for the app to export
   * from a Convex module, e.g. in `convex/stripe.ts`:
   *
   * ```ts
   * export const { syncWebhook, asyncWebhook } = stripe.webhookHandlers();
   * ```
   *
   * then pass the module to `registerRoutes` as
   * `webhooks: internal.stripe` (no cast needed).
   *
   * Contract:
   * - `syncWebhook` is an internal mutation that routes by `dispatcher` and
   *   performs the component table upsert AND the configured sync trigger in
   *   the SAME transaction. A trigger that throws rolls back the upsert.
   * - `asyncWebhook` is an internal action, scheduled by the webhook handler
   *   AFTER the upsert transaction commits, that routes by `hook` and runs the
   *   configured async hook (best-effort side effects).
   */
  // NOTE: no explicit return annotation — the inferred type preserves the
  // `RegisteredMutation`/`RegisteredAction` brands so Convex codegen registers
  // the app's re-exported `syncWebhook`/`asyncWebhook` (annotating the return as
  // `WebhookHandlerRefs` would erase them to `FunctionReference` and drop the
  // functions from the generated `internal.<module>` API).
  webhookHandlers() {
    const component = this.component;
    const triggers = this._triggers;
    const hooks = this._hooks;

    type DispatcherSpec = {
      /** Component query path used to read the doc before/after the upsert */
      getter: string;
      /** Query arg name for the Stripe id lookup */
      idArg: string;
      /** Field in `data` holding the Stripe id */
      idField: string;
      /** Component mutation path performing the upsert */
      upsert: string;
    };

    /** Runs `dispatch` with the post-upsert doc (and pre-upsert doc, if any). */
    type Dispatch<T> = (
      ctx: SyncTriggerCtx,
      newDoc: T,
      oldDoc: T | null,
    ) => Promise<void>;

    /**
     * Upsert a component doc and then run `dispatch` with the post-upsert doc
     * (and the pre-upsert doc, if any). When no `dispatch` is configured the
     * before/after doc reads are skipped and only the upsert runs.
     *
     * This is the extracted body of every old `triggersApi()` dispatcher,
     * keyed by name so a single `syncWebhook` mutation can run them all.
     */
    const runUpsertAndTrigger = async <T>(
      ctx: SyncTriggerCtx,
      name: string,
      spec: DispatcherSpec,
      dispatch: Dispatch<T> | undefined,
      record: Record<string, unknown>,
    ): Promise<void> => {
      const id = record[spec.idField];
      if (typeof id !== "string") {
        throw new Error(
          `[better-stripe] ${name}: missing ${spec.idField} in data`,
        );
      }
      if (!dispatch) {
        // No trigger configured — upsert only, skip the doc reads.
        await ctx.runMutation(componentRef(component, spec.upsert), record);
        return;
      }
      const lookup = { [spec.idArg]: id };
      const oldDoc = (await ctx.runQuery(
        componentRef(component, spec.getter),
        lookup,
      )) as T | null;
      await ctx.runMutation(componentRef(component, spec.upsert), record);
      const newDoc = (await ctx.runQuery(
        componentRef(component, spec.getter),
        lookup,
      )) as T | null;
      if (newDoc === null) {
        // Mutations read their own writes, so this cannot happen;
        // fail loudly if it ever does.
        throw new Error(
          `[better-stripe] ${name}: doc not found after upsert ` +
            `(${spec.idField}=${id})`,
        );
      }
      await dispatch(ctx, newDoc, oldDoc);
    };

    /** Standard create/update split used by most dispatchers. */
    const splitCreateUpdate = <T>(
      onCreate?: (ctx: SyncTriggerCtx, doc: T) => Promise<void>,
      onUpdate?: (ctx: SyncTriggerCtx, newDoc: T, oldDoc: T) => Promise<void>,
    ): Dispatch<T> | undefined =>
      onCreate || onUpdate
        ? async (ctx, newDoc, oldDoc) => {
            if (oldDoc === null) {
              await onCreate?.(ctx, newDoc);
            } else {
              await onUpdate?.(ctx, newDoc, oldDoc);
            }
          }
        : undefined;

    const onCheckoutCompleted = triggers?.checkoutSession?.onCompleted;
    const onSubscriptionDeleted = triggers?.subscription?.onDelete;

    /**
     * One routing entry per dispatcher. `run` closes over the same spec +
     * dispatch wiring the old per-dispatcher mutations used, so `syncWebhook`
     * is a mechanical collapse — not a behavior change.
     */
    const SYNC: Record<
      TriggerDispatcherName,
      (ctx: SyncTriggerCtx, record: Record<string, unknown>) => Promise<void>
    > = {
      accountUpserted: (ctx, record) =>
        runUpsertAndTrigger<StripeComponentAccount>(
          ctx,
          "accountUpserted",
          {
            getter: "core/queries/getAccountByStripeId",
            idArg: "stripeAccountId",
            idField: "stripeAccountId",
            upsert: DISPATCHER_UPSERT_PATHS.accountUpserted,
          },
          splitCreateUpdate(
            triggers?.account?.onCreate,
            triggers?.account?.onUpdate,
          ),
          record,
        ),
      productUpserted: (ctx, record) =>
        runUpsertAndTrigger<StripeComponentProduct>(
          ctx,
          "productUpserted",
          {
            getter: "products/queries/getProductByStripeId",
            idArg: "stripeProductId",
            idField: "stripeProductId",
            upsert: DISPATCHER_UPSERT_PATHS.productUpserted,
          },
          splitCreateUpdate(
            triggers?.product?.onCreate,
            triggers?.product?.onUpdate,
          ),
          record,
        ),
      priceUpserted: (ctx, record) =>
        runUpsertAndTrigger<StripeComponentPrice>(
          ctx,
          "priceUpserted",
          {
            getter: "products/queries/getPriceByStripeId",
            idArg: "stripePriceId",
            idField: "stripePriceId",
            upsert: DISPATCHER_UPSERT_PATHS.priceUpserted,
          },
          splitCreateUpdate(
            triggers?.price?.onCreate,
            triggers?.price?.onUpdate,
          ),
          record,
        ),
      subscriptionUpserted: (ctx, record) =>
        runUpsertAndTrigger<StripeComponentSubscription>(
          ctx,
          "subscriptionUpserted",
          {
            getter: "billing/queries/getSubscriptionByStripeId",
            idArg: "stripeSubscriptionId",
            idField: "stripeSubscriptionId",
            upsert: DISPATCHER_UPSERT_PATHS.subscriptionUpserted,
          },
          splitCreateUpdate(
            triggers?.subscription?.onCreate,
            triggers?.subscription?.onUpdate,
          ),
          record,
        ),
      // Special case: marks the subscription canceled via upsert, then fires
      // onDelete with the resulting doc. No pre-upsert read is needed.
      subscriptionDeleted: async (ctx, record) => {
        const id = record.stripeSubscriptionId;
        if (typeof id !== "string") {
          throw new Error(
            "[better-stripe] subscriptionDeleted: missing stripeSubscriptionId in data",
          );
        }
        await ctx.runMutation(
          componentRef(component, DISPATCHER_UPSERT_PATHS.subscriptionDeleted),
          record,
        );
        if (!onSubscriptionDeleted) return;
        const doc = (await ctx.runQuery(
          componentRef(component, "billing/queries/getSubscriptionByStripeId"),
          { stripeSubscriptionId: id },
        )) as StripeComponentSubscription | null;
        if (doc === null) {
          // Mutations read their own writes, so this cannot happen;
          // fail loudly if it ever does.
          throw new Error(
            "[better-stripe] subscriptionDeleted: doc not found after " +
              `upsert (stripeSubscriptionId=${id})`,
          );
        }
        await onSubscriptionDeleted(ctx, doc);
      },
      checkoutSessionUpserted: (ctx, record) =>
        runUpsertAndTrigger<StripeComponentCheckoutSession>(
          ctx,
          "checkoutSessionUpserted",
          {
            getter: "billing/queries/getCheckoutSessionByStripeId",
            idArg: "stripeSessionId",
            idField: "stripeSessionId",
            upsert: DISPATCHER_UPSERT_PATHS.checkoutSessionUpserted,
          },
          onCheckoutCompleted
            ? async (innerCtx, newDoc, oldDoc) => {
                // Fire onCompleted exactly once: on the transition into
                // "complete".
                if (
                  newDoc.status === "complete" &&
                  oldDoc?.status !== "complete"
                ) {
                  await onCheckoutCompleted(innerCtx, newDoc);
                }
              }
            : undefined,
          record,
        ),
      invoiceUpserted: (ctx, record) =>
        runUpsertAndTrigger<StripeComponentInvoice>(
          ctx,
          "invoiceUpserted",
          {
            getter: "billing/queries/getInvoiceByStripeId",
            idArg: "stripeInvoiceId",
            idField: "stripeInvoiceId",
            upsert: DISPATCHER_UPSERT_PATHS.invoiceUpserted,
          },
          splitCreateUpdate(
            triggers?.invoice?.onCreate,
            triggers?.invoice?.onUpdate,
          ),
          record,
        ),
      paymentUpserted: (ctx, record) =>
        runUpsertAndTrigger<StripeComponentPayment>(
          ctx,
          "paymentUpserted",
          {
            getter: "connect/queries/getPaymentByStripeId",
            idArg: "stripePaymentIntentId",
            idField: "stripePaymentIntentId",
            upsert: DISPATCHER_UPSERT_PATHS.paymentUpserted,
          },
          // SyncTriggers.payment has no onUpdate
          splitCreateUpdate(triggers?.payment?.onCreate, undefined),
          record,
        ),
      payoutUpserted: (ctx, record) =>
        runUpsertAndTrigger<StripeComponentPayout>(
          ctx,
          "payoutUpserted",
          {
            getter: "connect/queries/getPayoutByStripeId",
            idArg: "stripePayoutId",
            idField: "stripePayoutId",
            upsert: DISPATCHER_UPSERT_PATHS.payoutUpserted,
          },
          splitCreateUpdate(
            triggers?.payout?.onCreate,
            triggers?.payout?.onUpdate,
          ),
          record,
        ),
      refundUpserted: (ctx, record) =>
        runUpsertAndTrigger<StripeComponentRefund>(
          ctx,
          "refundUpserted",
          {
            getter: "connect/queries/getRefundByStripeId",
            idArg: "stripeRefundId",
            idField: "stripeRefundId",
            upsert: DISPATCHER_UPSERT_PATHS.refundUpserted,
          },
          splitCreateUpdate(
            triggers?.refund?.onCreate,
            triggers?.refund?.onUpdate,
          ),
          record,
        ),
      disputeUpserted: (ctx, record) =>
        runUpsertAndTrigger<StripeComponentDispute>(
          ctx,
          "disputeUpserted",
          {
            getter: "connect/queries/getDisputeByStripeId",
            idArg: "stripeDisputeId",
            idField: "stripeDisputeId",
            upsert: DISPATCHER_UPSERT_PATHS.disputeUpserted,
          },
          splitCreateUpdate(
            triggers?.dispute?.onCreate,
            triggers?.dispute?.onUpdate,
          ),
          record,
        ),
    };

    /** One routing entry per async hook — identical mapping to the old API. */
    const ASYNC: Record<
      AsyncHookName,
      ((ctx: AsyncHookCtx, doc: unknown) => Promise<void>) | undefined
    > = {
      afterAccountUpdated: hooks?.onAccountUpdated as
        | ((ctx: AsyncHookCtx, doc: unknown) => Promise<void>)
        | undefined,
      afterCheckoutCompleted: hooks?.onCheckoutCompleted as
        | ((ctx: AsyncHookCtx, doc: unknown) => Promise<void>)
        | undefined,
      afterSubscriptionUpdated: hooks?.onSubscriptionUpdated as
        | ((ctx: AsyncHookCtx, doc: unknown) => Promise<void>)
        | undefined,
      afterSubscriptionCanceled: hooks?.onSubscriptionCanceled as
        | ((ctx: AsyncHookCtx, doc: unknown) => Promise<void>)
        | undefined,
      afterTrialEnding: hooks?.onTrialEnding as
        | ((ctx: AsyncHookCtx, doc: unknown) => Promise<void>)
        | undefined,
      afterInvoicePaid: hooks?.onInvoicePaid as
        | ((ctx: AsyncHookCtx, doc: unknown) => Promise<void>)
        | undefined,
      afterInvoicePaymentFailed: hooks?.onInvoicePaymentFailed as
        | ((ctx: AsyncHookCtx, doc: unknown) => Promise<void>)
        | undefined,
      afterPaymentSucceeded: hooks?.onPaymentSucceeded as
        | ((ctx: AsyncHookCtx, doc: unknown) => Promise<void>)
        | undefined,
      afterPaymentFailed: hooks?.onPaymentFailed as
        | ((ctx: AsyncHookCtx, doc: unknown) => Promise<void>)
        | undefined,
      afterPayoutCompleted: hooks?.onPayoutCompleted as
        | ((ctx: AsyncHookCtx, doc: unknown) => Promise<void>)
        | undefined,
      afterRefundCreated: hooks?.onRefundCreated as
        | ((ctx: AsyncHookCtx, doc: unknown) => Promise<void>)
        | undefined,
      afterDisputeCreated: hooks?.onDisputeCreated as
        | ((ctx: AsyncHookCtx, doc: unknown) => Promise<void>)
        | undefined,
      afterDisputeClosed: hooks?.onDisputeClosed as
        | ((ctx: AsyncHookCtx, doc: unknown) => Promise<void>)
        | undefined,
    };

    const syncWebhook = internalMutationGeneric({
      args: { dispatcher: v.string(), data: v.any() },
      returns: v.null(),
      handler: async (ctx, { dispatcher, data }) => {
        const run = SYNC[dispatcher as TriggerDispatcherName];
        if (!run) {
          throw new Error(`[better-stripe] unknown dispatcher: ${dispatcher}`);
        }
        await run(
          ctx as unknown as SyncTriggerCtx,
          data as Record<string, unknown>,
        );
        return null;
      },
    });

    const asyncWebhook = internalActionGeneric({
      args: { hook: v.string(), doc: v.any() },
      returns: v.null(),
      handler: async (ctx, { hook, doc }) => {
        await ASYNC[hook as AsyncHookName]?.(
          ctx as unknown as AsyncHookCtx,
          doc,
        );
        return null;
      },
    });

    return { syncWebhook, asyncWebhook };
  }
}
