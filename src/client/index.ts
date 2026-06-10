import { internalActionGeneric, internalMutationGeneric } from "convex/server";
import { v } from "convex/values";
import Stripe from "stripe";

import type { ComponentApi } from "../component/_generated/component.js";
import * as checkoutImpl from "./billing/checkout.js";
import * as invoicesImpl from "./billing/invoices.js";
import * as subscriptionsImpl from "./billing/subscriptions.js";
import * as paymentMethodsImpl from "./connect/paymentMethods.js";
import * as payoutsImpl from "./connect/payouts.js";
import * as accountLinksImpl from "./core/accountLinks.js";
import * as accountsImpl from "./core/accounts.js";
import * as configImpl from "./core/config.js";
import type { Component, RunCtx } from "./helpers.js";
import { getStripeClient } from "./helpers.js";
import type {
  V2AccountRetrieveInclude,
  V2AccountUpdateParams,
} from "./stripe-types.js";
import { componentRef } from "./webhooks/helpers.js";
import * as pricesImpl from "./products/prices.js";
import * as productsImpl from "./products/products.js";
import type {
  AccountLinkWithStatus,
  AsyncHookCtx,
  AsyncHooks,
  BetterStripeOptions,
  StripeComponentAccount,
  StripeComponentCheckoutSession,
  StripeComponentInvoice,
  StripeComponentPrice,
  StripeComponentProduct,
  StripeComponentSubscription,
  SyncTriggerCtx,
  SyncTriggers,
} from "./types.js";
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
export type { BetterStripeOptions, RegisterRoutesConfig } from "./types.js";
export type {
  StripeDashboardResourceType,
  StripeMode,
} from "./utils/stripeDashboardUrl.js";
export type {
  AccountLinkWithStatus,
  AsyncHookRef,
  PaymentMethodCard,
  PaymentMethodLike,
  StripeComponentAccount,
  StripeComponentCheckoutSession,
  StripeComponentInvoice,
  StripeComponentPrice,
  StripeComponentProduct,
  StripeComponentSubscription,
  StripeCountrySpecs,
  StripeEventHandler,
  StripeEventHandlers,
  StripeV2Account,
  StripeWebhookEvent,
  TriggerApiRefs,
  TriggerDispatchRef,
  V2ThinEvent,
  WebhookActionCtx,
} from "./types.js";

export type BetterStripeComponent = ComponentApi;

// =============================================================================
// BETTER STRIPE CLIENT
// =============================================================================

export class BetterStripe {
  public component: Component;
  private _apiKey?: string;
  private _triggers?: SyncTriggers;
  private _hooks?: AsyncHooks;

  constructor(component: BetterStripeComponent, options?: BetterStripeOptions) {
    this.component = component;
    this._apiKey = options?.STRIPE_SECRET_KEY;
    this._triggers = options?.triggers;
    this._hooks = options?.hooks;
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

  async addRecipientConfiguration(
    ctx: RunCtx,
    opts: { stripeAccountId: string },
  ) {
    return accountsImpl.addRecipientConfiguration(this.stripe(), ctx, opts);
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
    return productsImpl.createProduct(this.stripe(), this.component, ctx, opts);
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
    return productsImpl.updateProduct(this.stripe(), ctx, opts);
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
      metadata?: Record<string, string>;
      sessionOverrides?: Record<string, unknown>;
    },
  ) {
    return checkoutImpl.createCheckoutSession(
      this.stripe(),
      this.component,
      ctx,
      opts,
    );
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

  async listSubscriptions(
    ctx: RunCtx,
    opts?: { status?: string; limit?: number },
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

  async getActiveSubscription(
    ctx: RunCtx,
    opts: { userId: string; orgId?: string },
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

  async upsertInvoice(
    ctx: RunCtx,
    opts: {
      stripeInvoiceId: string;
      userId: string;
      orgId?: string;
      accountId?: string;
      subscriptionId?: string;
      status: string;
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

  async getPayout(ctx: RunCtx, opts: { payoutId: string }) {
    return payoutsImpl.getPayout(this.component, ctx, opts);
  }

  async listPayouts(
    ctx: RunCtx,
    opts?: { accountId?: string; status?: string; limit?: number },
  ) {
    return payoutsImpl.listPayouts(this.component, ctx, opts);
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
  // TRIGGER API EXPORT (BetterAuth-style)
  // ============================================================================

  /**
   * Build the trigger/hook function definitions for the app to export from a
   * Convex module, e.g. in `convex/stripe.ts`:
   *
   * ```ts
   * export const {
   *   accountUpserted, productUpserted, priceUpserted,
   *   subscriptionUpserted, subscriptionDeleted, checkoutSessionUpserted,
   *   invoiceUpserted, paymentUpserted, payoutUpserted,
   *   afterAccountUpdated, afterCheckoutCompleted, afterSubscriptionUpdated,
   *   afterSubscriptionCanceled, afterTrialEnding, afterInvoicePaid,
   *   afterPaymentSucceeded, afterPaymentFailed, afterPayoutCompleted,
   * } = stripe.triggersApi();
   * ```
   *
   * then pass the module to `registerRoutes` as
   * `triggers: internal.stripe as unknown as TriggerApiRefs`.
   *
   * Contract:
   * - The `*Upserted`/`*Deleted` dispatchers are internal mutations that
   *   perform the component table upsert AND the configured sync trigger in
   *   the SAME transaction. A trigger that throws rolls back the upsert.
   * - The `after*` wrappers are internal actions scheduled by the webhook
   *   handler AFTER the upsert transaction commits (best-effort side effects).
   */
  triggersApi() {
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

    const createUpsertDispatcher = <T>(
      spec: DispatcherSpec,
      onCreate?: (ctx: SyncTriggerCtx, doc: T) => Promise<void>,
      onUpdate?: (ctx: SyncTriggerCtx, newDoc: T, oldDoc: T) => Promise<void>,
    ) =>
      internalMutationGeneric({
        args: { data: v.any() },
        returns: v.null(),
        handler: async (ctx, { data }) => {
          const record = data as Record<string, unknown>;
          const lookup = { [spec.idArg]: record[spec.idField] };
          const oldDoc = (await ctx.runQuery(
            componentRef(component, spec.getter),
            lookup,
          )) as T | null;
          await ctx.runMutation(componentRef(component, spec.upsert), record);
          const newDoc = (await ctx.runQuery(
            componentRef(component, spec.getter),
            lookup,
          )) as T;
          if (oldDoc === null) {
            await onCreate?.(ctx as unknown as SyncTriggerCtx, newDoc);
          } else {
            await onUpdate?.(ctx as unknown as SyncTriggerCtx, newDoc, oldDoc);
          }
          return null;
        },
      });

    const createAsyncHook = <T>(
      handler?: (ctx: AsyncHookCtx, doc: T) => Promise<void>,
    ) =>
      internalActionGeneric({
        args: { doc: v.any() },
        returns: v.null(),
        handler: async (ctx, args) => {
          await handler?.(ctx as unknown as AsyncHookCtx, args.doc as T);
          return null;
        },
      });

    return {
      // --- Sync dispatchers: component upsert + trigger, one transaction ---
      accountUpserted: createUpsertDispatcher<StripeComponentAccount>(
        {
          getter: "core/queries/getAccountByStripeId",
          idArg: "stripeAccountId",
          idField: "stripeAccountId",
          upsert: "core/mutations/upsertAccountInternal",
        },
        triggers?.account?.onCreate,
        triggers?.account?.onUpdate,
      ),
      productUpserted: createUpsertDispatcher<StripeComponentProduct>(
        {
          getter: "products/queries/getProductByStripeId",
          idArg: "stripeProductId",
          idField: "stripeProductId",
          upsert: "products/mutations/upsertProduct",
        },
        triggers?.product?.onCreate,
        triggers?.product?.onUpdate,
      ),
      priceUpserted: createUpsertDispatcher<StripeComponentPrice>(
        {
          getter: "products/queries/getPriceByStripeId",
          idArg: "stripePriceId",
          idField: "stripePriceId",
          upsert: "products/mutations/upsertPrice",
        },
        triggers?.price?.onCreate,
        triggers?.price?.onUpdate,
      ),
      subscriptionUpserted: createUpsertDispatcher<StripeComponentSubscription>(
        {
          getter: "billing/queries/getSubscriptionByStripeId",
          idArg: "stripeSubscriptionId",
          idField: "stripeSubscriptionId",
          upsert: "billing/mutations/upsertSubscription",
        },
        triggers?.subscription?.onCreate,
        triggers?.subscription?.onUpdate,
      ),
      subscriptionDeleted: internalMutationGeneric({
        args: { data: v.any() },
        returns: v.null(),
        handler: async (ctx, { data }) => {
          const record = data as Record<string, unknown>;
          await ctx.runMutation(
            componentRef(component, "billing/mutations/upsertSubscription"),
            record,
          );
          const doc = (await ctx.runQuery(
            componentRef(
              component,
              "billing/queries/getSubscriptionByStripeId",
            ),
            { stripeSubscriptionId: record.stripeSubscriptionId },
          )) as StripeComponentSubscription;
          await triggers?.subscription?.onDelete?.(
            ctx as unknown as SyncTriggerCtx,
            doc,
          );
          return null;
        },
      }),
      checkoutSessionUpserted: internalMutationGeneric({
        args: { data: v.any() },
        returns: v.null(),
        handler: async (ctx, { data }) => {
          const record = data as Record<string, unknown>;
          const lookup = { stripeSessionId: record.stripeSessionId };
          const oldDoc = (await ctx.runQuery(
            componentRef(
              component,
              "billing/queries/getCheckoutSessionByStripeId",
            ),
            lookup,
          )) as StripeComponentCheckoutSession | null;
          await ctx.runMutation(
            componentRef(component, "billing/mutations/upsertCheckoutSession"),
            record,
          );
          const newDoc = (await ctx.runQuery(
            componentRef(
              component,
              "billing/queries/getCheckoutSessionByStripeId",
            ),
            lookup,
          )) as StripeComponentCheckoutSession;
          // Fire onCompleted exactly once: on the transition into "complete".
          if (newDoc?.status === "complete" && oldDoc?.status !== "complete") {
            await triggers?.checkoutSession?.onCompleted?.(
              ctx as unknown as SyncTriggerCtx,
              newDoc,
            );
          }
          return null;
        },
      }),
      invoiceUpserted: createUpsertDispatcher<StripeComponentInvoice>(
        {
          getter: "billing/queries/getInvoiceByStripeId",
          idArg: "stripeInvoiceId",
          idField: "stripeInvoiceId",
          upsert: "billing/mutations/upsertInvoice",
        },
        triggers?.invoice?.onCreate,
        triggers?.invoice?.onUpdate,
      ),
      paymentUpserted: createUpsertDispatcher(
        {
          getter: "connect/queries/getPaymentByStripeId",
          idArg: "stripePaymentIntentId",
          idField: "stripePaymentIntentId",
          upsert: "connect/mutations/upsertPayment",
        },
        triggers?.payment?.onCreate,
        undefined, // SyncTriggers.payment has no onUpdate
      ),
      payoutUpserted: createUpsertDispatcher(
        {
          getter: "connect/queries/getPayoutByStripeId",
          idArg: "stripePayoutId",
          idField: "stripePayoutId",
          upsert: "connect/mutations/upsertPayout",
        },
        triggers?.payout?.onCreate,
        triggers?.payout?.onUpdate,
      ),

      // --- Async hook wrappers (scheduled by the webhook handler) ---
      afterAccountUpdated: createAsyncHook(hooks?.onAccountUpdated),
      afterCheckoutCompleted: createAsyncHook(hooks?.onCheckoutCompleted),
      afterSubscriptionUpdated: createAsyncHook(hooks?.onSubscriptionUpdated),
      afterSubscriptionCanceled: createAsyncHook(hooks?.onSubscriptionCanceled),
      afterTrialEnding: createAsyncHook(hooks?.onTrialEnding),
      afterInvoicePaid: createAsyncHook(hooks?.onInvoicePaid),
      afterPaymentSucceeded: createAsyncHook(hooks?.onPaymentSucceeded),
      afterPaymentFailed: createAsyncHook(hooks?.onPaymentFailed),
      afterPayoutCompleted: createAsyncHook(hooks?.onPayoutCompleted),
    };
  }
}
