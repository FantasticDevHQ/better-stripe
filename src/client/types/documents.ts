// ---------------------------------------------------------------------------
// Document shapes (for consumers to type their query results)
//
// Enum types are imported from component validators to stay in sync with
// the canonical Convex schema definitions.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Stripe SDK re-exports
//
// These types come directly from the Stripe Node SDK ('stripe' package).
// We re-export them so consumers import from '@getdojo/better-stripe' without
// needing a direct dependency on the stripe package.
// ---------------------------------------------------------------------------
import type Stripe from 'stripe';

import type {
  CheckoutSessionMode,
  CheckoutSessionStatus,
  SubscriptionStatus,
} from '../../component/billing/validators.js';
import type {
  PaymentStatus,
  PayoutStatus,
} from '../../component/connect/validators.js';
import type {
  AppliedConfiguration,
  OnboardingStatus,
} from '../../component/core/validators.js';
import type { PriceType } from '../../component/products/validators.js';
import type { WebhookEventStatus } from '../../component/webhooks/validators.js';

export type StripeComponentAccount = {
  _id: string;
  _creationTime: number;
  stripeAccountId: string;
  userId: string;
  orgId?: string;
  email?: string;
  name?: string;
  country?: string;
  capabilities?: Record<string, unknown>;
  requirements?: Record<string, unknown>;
  configuration?: Record<string, unknown>;
  appliedConfigurations?: AppliedConfiguration[];
  onboardingStatus?: OnboardingStatus;
  missingRequirements?: string[];
  metadata?: Record<string, unknown>;
};

export type StripeComponentPayment = {
  _id: string;
  _creationTime: number;
  stripePaymentIntentId: string;
  userId: string;
  orgId?: string;
  accountId?: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  metadata?: Record<string, unknown>;
};

export type StripeComponentPayout = {
  _id: string;
  _creationTime: number;
  stripePayoutId: string;
  accountId: string;
  amount: number;
  currency: string;
  status: PayoutStatus;
  arrivalDate?: string;
  method?: string;
  metadata?: Record<string, unknown>;
};

export type StripeComponentWebhookEvent = {
  _id: string;
  _creationTime: number;
  stripeEventId: string;
  eventType: string;
  livemode?: boolean;
  processedAt: number;
  status: WebhookEventStatus;
  lastError?: string;
};

export type StripeComponentProduct = {
  _id: string;
  _creationTime: number;
  stripeProductId: string;
  accountId?: string;
  name: string;
  description?: string;
  active: boolean;
  metadata?: Record<string, unknown>;
};

export type StripeComponentPrice = {
  _id: string;
  _creationTime: number;
  stripePriceId: string;
  productId: string;
  stripeProductId: string;
  nickname?: string;
  unitAmount: number;
  currency: string;
  active: boolean;
  type: PriceType;
  interval?: 'day' | 'week' | 'month' | 'year';
  intervalCount?: number;
  metadata?: Record<string, unknown>;
};

export type StripeComponentSubscription = {
  _id: string;
  _creationTime: number;
  stripeSubscriptionId: string;
  accountId?: string;
  userId: string;
  orgId?: string;
  status: SubscriptionStatus;
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
};

export type StripeComponentCheckoutSession = {
  _id: string;
  _creationTime: number;
  stripeSessionId: string;
  userId: string;
  orgId?: string;
  accountId?: string;
  mode: CheckoutSessionMode;
  status: CheckoutSessionStatus;
  clientSecret?: string;
  url?: string;
  priceId?: string;
  metadata?: Record<string, unknown>;
};

export type StripeComponentInvoice = {
  _id: string;
  _creationTime: number;
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
};

/** Stripe V2 Account — see https://docs.stripe.com/api/v2/core/accounts */
export type StripeV2Account = Stripe.V2.Core.Account;

/** Stripe Country Spec — see https://docs.stripe.com/api/country_specs */
export type StripeCountrySpecs = Stripe.CountrySpec;

/** Stripe Payment Method — see https://docs.stripe.com/api/payment_methods */
export type PaymentMethodLike = Stripe.PaymentMethod;

/** Card details from a Stripe Payment Method */
export type PaymentMethodCard = Stripe.PaymentMethod.Card;

// ---------------------------------------------------------------------------
// Account link with status result (our own return type, not from Stripe SDK)
// ---------------------------------------------------------------------------

export type AccountLinkWithStatus = {
  url: string;
  linkType: 'login' | 'onboarding' | 'setup';
};
