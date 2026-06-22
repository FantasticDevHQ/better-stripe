/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    billing: {
      mutations: {
        upsertCheckoutSession: FunctionReference<
          "mutation",
          "internal",
          {
            accountId?: string;
            clientSecret?: string;
            metadata?: any;
            mode: "payment" | "subscription" | "setup";
            orgId?: string;
            priceId?: string;
            status: "open" | "complete" | "expired";
            stripeSessionId: string;
            url?: string;
            userId: string;
          },
          null,
          Name
        >;
        upsertInvoice: FunctionReference<
          "mutation",
          "internal",
          {
            accountId?: string;
            amountDue: number;
            amountPaid: number;
            currency: string;
            hostedInvoiceUrl?: string;
            invoicePdf?: string;
            metadata?: any;
            orgId?: string;
            periodEnd?: string;
            periodStart?: string;
            status: "draft" | "open" | "paid" | "uncollectible" | "void";
            stripeInvoiceId: string;
            subscriptionId?: string;
            userId: string;
          },
          null,
          Name
        >;
        upsertSubscription: FunctionReference<
          "mutation",
          "internal",
          {
            accountId?: string;
            cancelAtPeriodEnd: boolean;
            canceledAt?: string;
            currentPeriodEnd?: string;
            currentPeriodStart?: string;
            isTrialing: boolean;
            metadata?: any;
            orgId?: string;
            priceId?: string;
            quantity?: number;
            status:
              | "active"
              | "trialing"
              | "past_due"
              | "canceled"
              | "incomplete"
              | "incomplete_expired"
              | "unpaid"
              | "paused";
            stripeSubscriptionId: string;
            trialEnd?: string;
            trialStart?: string;
            userId: string;
          },
          null,
          Name
        >;
      };
      queries: {
        getActiveSubscription: FunctionReference<
          "query",
          "internal",
          { orgId?: string; userId: string },
          {
            _creationTime: number;
            _id: string;
            accountId?: string;
            cancelAtPeriodEnd: boolean;
            canceledAt?: string;
            currentPeriodEnd?: string;
            currentPeriodStart?: string;
            isTrialing: boolean;
            metadata?: any;
            orgId?: string;
            priceId?: string;
            quantity?: number;
            status:
              | "active"
              | "trialing"
              | "past_due"
              | "canceled"
              | "incomplete"
              | "incomplete_expired"
              | "unpaid"
              | "paused";
            stripeSubscriptionId: string;
            trialEnd?: string;
            trialStart?: string;
            userId: string;
          } | null,
          Name
        >;
        getCheckoutSession: FunctionReference<
          "query",
          "internal",
          { sessionId: string },
          {
            _creationTime: number;
            _id: string;
            accountId?: string;
            clientSecret?: string;
            metadata?: any;
            mode: "payment" | "subscription" | "setup";
            orgId?: string;
            priceId?: string;
            status: "open" | "complete" | "expired";
            stripeSessionId: string;
            url?: string;
            userId: string;
          } | null,
          Name
        >;
        getCheckoutSessionByStripeId: FunctionReference<
          "query",
          "internal",
          { stripeSessionId: string },
          {
            _creationTime: number;
            _id: string;
            accountId?: string;
            clientSecret?: string;
            metadata?: any;
            mode: "payment" | "subscription" | "setup";
            orgId?: string;
            priceId?: string;
            status: "open" | "complete" | "expired";
            stripeSessionId: string;
            url?: string;
            userId: string;
          } | null,
          Name
        >;
        getInvoiceByStripeId: FunctionReference<
          "query",
          "internal",
          { stripeInvoiceId: string },
          {
            _creationTime: number;
            _id: string;
            accountId?: string;
            amountDue: number;
            amountPaid: number;
            currency: string;
            hostedInvoiceUrl?: string;
            invoicePdf?: string;
            metadata?: any;
            orgId?: string;
            periodEnd?: string;
            periodStart?: string;
            status: "draft" | "open" | "paid" | "uncollectible" | "void";
            stripeInvoiceId: string;
            subscriptionId?: string;
            userId: string;
          } | null,
          Name
        >;
        getSubscription: FunctionReference<
          "query",
          "internal",
          { subscriptionId: string },
          {
            _creationTime: number;
            _id: string;
            accountId?: string;
            cancelAtPeriodEnd: boolean;
            canceledAt?: string;
            currentPeriodEnd?: string;
            currentPeriodStart?: string;
            isTrialing: boolean;
            metadata?: any;
            orgId?: string;
            priceId?: string;
            quantity?: number;
            status:
              | "active"
              | "trialing"
              | "past_due"
              | "canceled"
              | "incomplete"
              | "incomplete_expired"
              | "unpaid"
              | "paused";
            stripeSubscriptionId: string;
            trialEnd?: string;
            trialStart?: string;
            userId: string;
          } | null,
          Name
        >;
        getSubscriptionByStripeId: FunctionReference<
          "query",
          "internal",
          { stripeSubscriptionId: string },
          {
            _creationTime: number;
            _id: string;
            accountId?: string;
            cancelAtPeriodEnd: boolean;
            canceledAt?: string;
            currentPeriodEnd?: string;
            currentPeriodStart?: string;
            isTrialing: boolean;
            metadata?: any;
            orgId?: string;
            priceId?: string;
            quantity?: number;
            status:
              | "active"
              | "trialing"
              | "past_due"
              | "canceled"
              | "incomplete"
              | "incomplete_expired"
              | "unpaid"
              | "paused";
            stripeSubscriptionId: string;
            trialEnd?: string;
            trialStart?: string;
            userId: string;
          } | null,
          Name
        >;
        getTrialStatus: FunctionReference<
          "query",
          "internal",
          { subscriptionId: string },
          {
            daysRemaining: number;
            isTrialing: boolean;
            status:
              | "active"
              | "trialing"
              | "past_due"
              | "canceled"
              | "incomplete"
              | "incomplete_expired"
              | "unpaid"
              | "paused";
            trialEnd?: string;
            trialStart?: string;
          } | null,
          Name
        >;
        listCheckoutSessionsByUser: FunctionReference<
          "query",
          "internal",
          {
            limit?: number;
            status?: "open" | "complete" | "expired";
            userId: string;
          },
          Array<{
            _creationTime: number;
            _id: string;
            accountId?: string;
            clientSecret?: string;
            metadata?: any;
            mode: "payment" | "subscription" | "setup";
            orgId?: string;
            priceId?: string;
            status: "open" | "complete" | "expired";
            stripeSessionId: string;
            url?: string;
            userId: string;
          }>,
          Name
        >;
        listInvoices: FunctionReference<
          "query",
          "internal",
          {
            accountId?: string;
            limit?: number;
            status?: "draft" | "open" | "paid" | "uncollectible" | "void";
            subscriptionId?: string;
            userId?: string;
          },
          Array<{
            _creationTime: number;
            _id: string;
            accountId?: string;
            amountDue: number;
            amountPaid: number;
            currency: string;
            hostedInvoiceUrl?: string;
            invoicePdf?: string;
            metadata?: any;
            orgId?: string;
            periodEnd?: string;
            periodStart?: string;
            status: "draft" | "open" | "paid" | "uncollectible" | "void";
            stripeInvoiceId: string;
            subscriptionId?: string;
            userId: string;
          }>,
          Name
        >;
        listSubscriptions: FunctionReference<
          "query",
          "internal",
          {
            accountId?: string;
            limit?: number;
            status?:
              | "active"
              | "trialing"
              | "past_due"
              | "canceled"
              | "incomplete"
              | "incomplete_expired"
              | "unpaid"
              | "paused";
          },
          Array<{
            _creationTime: number;
            _id: string;
            accountId?: string;
            cancelAtPeriodEnd: boolean;
            canceledAt?: string;
            currentPeriodEnd?: string;
            currentPeriodStart?: string;
            isTrialing: boolean;
            metadata?: any;
            orgId?: string;
            priceId?: string;
            quantity?: number;
            status:
              | "active"
              | "trialing"
              | "past_due"
              | "canceled"
              | "incomplete"
              | "incomplete_expired"
              | "unpaid"
              | "paused";
            stripeSubscriptionId: string;
            trialEnd?: string;
            trialStart?: string;
            userId: string;
          }>,
          Name
        >;
        listSubscriptionsByOrg: FunctionReference<
          "query",
          "internal",
          { orgId: string; status?: string },
          Array<{
            _creationTime: number;
            _id: string;
            accountId?: string;
            cancelAtPeriodEnd: boolean;
            canceledAt?: string;
            currentPeriodEnd?: string;
            currentPeriodStart?: string;
            isTrialing: boolean;
            metadata?: any;
            orgId?: string;
            priceId?: string;
            quantity?: number;
            status:
              | "active"
              | "trialing"
              | "past_due"
              | "canceled"
              | "incomplete"
              | "incomplete_expired"
              | "unpaid"
              | "paused";
            stripeSubscriptionId: string;
            trialEnd?: string;
            trialStart?: string;
            userId: string;
          }>,
          Name
        >;
        listSubscriptionsByUser: FunctionReference<
          "query",
          "internal",
          { status?: string; userId: string },
          Array<{
            _creationTime: number;
            _id: string;
            accountId?: string;
            cancelAtPeriodEnd: boolean;
            canceledAt?: string;
            currentPeriodEnd?: string;
            currentPeriodStart?: string;
            isTrialing: boolean;
            metadata?: any;
            orgId?: string;
            priceId?: string;
            quantity?: number;
            status:
              | "active"
              | "trialing"
              | "past_due"
              | "canceled"
              | "incomplete"
              | "incomplete_expired"
              | "unpaid"
              | "paused";
            stripeSubscriptionId: string;
            trialEnd?: string;
            trialStart?: string;
            userId: string;
          }>,
          Name
        >;
      };
    };
    connect: {
      mutations: {
        upsertPayment: FunctionReference<
          "mutation",
          "internal",
          {
            accountId?: string;
            amount: number;
            currency: string;
            metadata?: any;
            orgId?: string;
            status:
              | "succeeded"
              | "failed"
              | "canceled"
              | "processing"
              | "requires_action";
            stripePaymentIntentId: string;
            userId: string;
          },
          null,
          Name
        >;
        upsertPayout: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            amount: number;
            arrivalDate?: string;
            currency: string;
            metadata?: any;
            method?: string;
            status: "pending" | "paid" | "failed" | "canceled" | "in_transit";
            stripePayoutId: string;
          },
          null,
          Name
        >;
      };
      queries: {
        getPaymentByStripeId: FunctionReference<
          "query",
          "internal",
          { stripePaymentIntentId: string },
          {
            _creationTime: number;
            _id: string;
            accountId?: string;
            amount: number;
            currency: string;
            metadata?: any;
            orgId?: string;
            status:
              | "succeeded"
              | "failed"
              | "canceled"
              | "processing"
              | "requires_action";
            stripePaymentIntentId: string;
            userId: string;
          } | null,
          Name
        >;
        getPayout: FunctionReference<
          "query",
          "internal",
          { payoutId: string },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            amount: number;
            arrivalDate?: string;
            currency: string;
            metadata?: any;
            method?: string;
            status: "pending" | "paid" | "failed" | "canceled" | "in_transit";
            stripePayoutId: string;
          } | null,
          Name
        >;
        getPayoutByStripeId: FunctionReference<
          "query",
          "internal",
          { stripePayoutId: string },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            amount: number;
            arrivalDate?: string;
            currency: string;
            metadata?: any;
            method?: string;
            status: "pending" | "paid" | "failed" | "canceled" | "in_transit";
            stripePayoutId: string;
          } | null,
          Name
        >;
        listPayouts: FunctionReference<
          "query",
          "internal",
          {
            accountId?: string;
            limit?: number;
            status?: "pending" | "paid" | "failed" | "canceled" | "in_transit";
          },
          Array<{
            _creationTime: number;
            _id: string;
            accountId: string;
            amount: number;
            arrivalDate?: string;
            currency: string;
            metadata?: any;
            method?: string;
            status: "pending" | "paid" | "failed" | "canceled" | "in_transit";
            stripePayoutId: string;
          }>,
          Name
        >;
      };
    };
    core: {
      mutations: {
        clearAllTables: FunctionReference<
          "mutation",
          "internal",
          {},
          { cleared: number; tables: Array<string> },
          Name
        >;
        deleteAccountByStripeId: FunctionReference<
          "mutation",
          "internal",
          { stripeAccountId: string },
          boolean,
          Name
        >;
        upsertAccount: FunctionReference<
          "mutation",
          "internal",
          {
            appliedConfigurations?: Array<
              "customer" | "merchant" | "recipient"
            >;
            capabilities?: any;
            configuration?: any;
            country?: string;
            email?: string;
            metadata?: any;
            missingRequirements?: Array<string>;
            name?: string;
            onboardingStatus?:
              | "pending"
              | "in_progress"
              | "complete"
              | "restricted";
            orgId?: string;
            requirements?: any;
            stripeAccountId: string;
            userId: string;
          },
          null,
          Name
        >;
        upsertAccountInternal: FunctionReference<
          "mutation",
          "internal",
          {
            appliedConfigurations?: Array<
              "customer" | "merchant" | "recipient"
            >;
            capabilities?: any;
            configuration?: any;
            country?: string;
            email?: string;
            metadata?: any;
            missingRequirements?: Array<string>;
            name?: string;
            onboardingStatus:
              | "pending"
              | "in_progress"
              | "complete"
              | "restricted";
            orgId?: string;
            requirements?: any;
            stripeAccountId: string;
            userId: string;
          },
          null,
          Name
        >;
      };
      queries: {
        getAccount: FunctionReference<
          "query",
          "internal",
          { accountId: string },
          {
            _creationTime: number;
            _id: string;
            appliedConfigurations?: Array<
              "customer" | "merchant" | "recipient"
            >;
            capabilities?: any;
            configuration?: any;
            country?: string;
            email?: string;
            metadata?: any;
            missingRequirements?: Array<string>;
            name?: string;
            onboardingStatus:
              | "pending"
              | "in_progress"
              | "complete"
              | "restricted";
            orgId?: string;
            requirements?: any;
            stripeAccountId: string;
            userId: string;
          } | null,
          Name
        >;
        getAccountByOrgId: FunctionReference<
          "query",
          "internal",
          { orgId: string },
          {
            _creationTime: number;
            _id: string;
            appliedConfigurations?: Array<
              "customer" | "merchant" | "recipient"
            >;
            capabilities?: any;
            configuration?: any;
            country?: string;
            email?: string;
            metadata?: any;
            missingRequirements?: Array<string>;
            name?: string;
            onboardingStatus:
              | "pending"
              | "in_progress"
              | "complete"
              | "restricted";
            orgId?: string;
            requirements?: any;
            stripeAccountId: string;
            userId: string;
          } | null,
          Name
        >;
        getAccountByStripeId: FunctionReference<
          "query",
          "internal",
          { stripeAccountId: string },
          {
            _creationTime: number;
            _id: string;
            appliedConfigurations?: Array<
              "customer" | "merchant" | "recipient"
            >;
            capabilities?: any;
            configuration?: any;
            country?: string;
            email?: string;
            metadata?: any;
            missingRequirements?: Array<string>;
            name?: string;
            onboardingStatus:
              | "pending"
              | "in_progress"
              | "complete"
              | "restricted";
            orgId?: string;
            requirements?: any;
            stripeAccountId: string;
            userId: string;
          } | null,
          Name
        >;
        getAccountByUserId: FunctionReference<
          "query",
          "internal",
          { userId: string },
          {
            _creationTime: number;
            _id: string;
            appliedConfigurations?: Array<
              "customer" | "merchant" | "recipient"
            >;
            capabilities?: any;
            configuration?: any;
            country?: string;
            email?: string;
            metadata?: any;
            missingRequirements?: Array<string>;
            name?: string;
            onboardingStatus:
              | "pending"
              | "in_progress"
              | "complete"
              | "restricted";
            orgId?: string;
            requirements?: any;
            stripeAccountId: string;
            userId: string;
          } | null,
          Name
        >;
        getAccountOnboardingStatus: FunctionReference<
          "query",
          "internal",
          { accountId: string },
          {
            capabilities: any;
            isReady: boolean;
            missingRequirements: Array<string>;
            onboardingStatus:
              | "pending"
              | "in_progress"
              | "complete"
              | "restricted";
          } | null,
          Name
        >;
        getPublishableKey: FunctionReference<
          "query",
          "internal",
          {},
          string | null,
          Name
        >;
        getStripeMode: FunctionReference<
          "query",
          "internal",
          {},
          "test" | "live",
          Name
        >;
      };
    };
    products: {
      mutations: {
        upsertPrice: FunctionReference<
          "mutation",
          "internal",
          {
            active: boolean;
            currency: string;
            interval?: "day" | "week" | "month" | "year";
            intervalCount?: number;
            metadata?: any;
            nickname?: string;
            productId: string;
            stripePriceId: string;
            stripeProductId: string;
            type: "one_time" | "recurring";
            unitAmount: number;
          },
          null,
          Name
        >;
        upsertProduct: FunctionReference<
          "mutation",
          "internal",
          {
            accountId?: string;
            active: boolean;
            description?: string;
            metadata?: any;
            name: string;
            stripeProductId: string;
          },
          null,
          Name
        >;
      };
      queries: {
        getPrice: FunctionReference<
          "query",
          "internal",
          { priceId: string },
          {
            _creationTime: number;
            _id: string;
            active: boolean;
            currency: string;
            interval?: "day" | "week" | "month" | "year";
            intervalCount?: number;
            metadata?: any;
            nickname?: string;
            productId: string;
            stripePriceId: string;
            stripeProductId: string;
            type: "one_time" | "recurring";
            unitAmount: number;
          } | null,
          Name
        >;
        getPriceByStripeId: FunctionReference<
          "query",
          "internal",
          { stripePriceId: string },
          {
            _creationTime: number;
            _id: string;
            active: boolean;
            currency: string;
            interval?: "day" | "week" | "month" | "year";
            intervalCount?: number;
            metadata?: any;
            nickname?: string;
            productId: string;
            stripePriceId: string;
            stripeProductId: string;
            type: "one_time" | "recurring";
            unitAmount: number;
          } | null,
          Name
        >;
        getProduct: FunctionReference<
          "query",
          "internal",
          { productId: string },
          {
            _creationTime: number;
            _id: string;
            accountId?: string;
            active: boolean;
            description?: string;
            metadata?: any;
            name: string;
            stripeProductId: string;
          } | null,
          Name
        >;
        getProductByStripeId: FunctionReference<
          "query",
          "internal",
          { stripeProductId: string },
          {
            _creationTime: number;
            _id: string;
            accountId?: string;
            active: boolean;
            description?: string;
            metadata?: any;
            name: string;
            stripeProductId: string;
          } | null,
          Name
        >;
        listPrices: FunctionReference<
          "query",
          "internal",
          { active?: boolean; limit?: number; productId?: string },
          Array<{
            _creationTime: number;
            _id: string;
            active: boolean;
            currency: string;
            interval?: "day" | "week" | "month" | "year";
            intervalCount?: number;
            metadata?: any;
            nickname?: string;
            productId: string;
            stripePriceId: string;
            stripeProductId: string;
            type: "one_time" | "recurring";
            unitAmount: number;
          }>,
          Name
        >;
        listPricesByProduct: FunctionReference<
          "query",
          "internal",
          { stripeProductId: string },
          Array<{
            _creationTime: number;
            _id: string;
            active: boolean;
            currency: string;
            interval?: "day" | "week" | "month" | "year";
            intervalCount?: number;
            metadata?: any;
            nickname?: string;
            productId: string;
            stripePriceId: string;
            stripeProductId: string;
            type: "one_time" | "recurring";
            unitAmount: number;
          }>,
          Name
        >;
        listProducts: FunctionReference<
          "query",
          "internal",
          { accountId?: string; active?: boolean; limit?: number },
          Array<{
            _creationTime: number;
            _id: string;
            accountId?: string;
            active: boolean;
            description?: string;
            metadata?: any;
            name: string;
            stripeProductId: string;
          }>,
          Name
        >;
      };
    };
    webhooks: {
      mutations: {
        insertWebhookEvent: FunctionReference<
          "mutation",
          "internal",
          { eventType: string; livemode?: boolean; stripeEventId: string },
          "inserted" | "processing" | "processed" | "failed" | "ignored",
          Name
        >;
        markWebhookEventFailed: FunctionReference<
          "mutation",
          "internal",
          { error: string; stripeEventId: string },
          null,
          Name
        >;
        markWebhookEventIgnored: FunctionReference<
          "mutation",
          "internal",
          { stripeEventId: string },
          null,
          Name
        >;
        markWebhookEventProcessed: FunctionReference<
          "mutation",
          "internal",
          { stripeEventId: string },
          null,
          Name
        >;
      };
      queries: {
        getWebhookEvent: FunctionReference<
          "query",
          "internal",
          { stripeEventId: string },
          {
            _creationTime: number;
            _id: string;
            eventType: string;
            lastError?: string;
            livemode?: boolean;
            processedAt: number;
            status: "processing" | "processed" | "failed" | "ignored";
            stripeEventId: string;
          } | null,
          Name
        >;
        listWebhookEvents: FunctionReference<
          "query",
          "internal",
          { eventType?: string; limit?: number; status?: string },
          Array<{
            _creationTime: number;
            _id: string;
            eventType: string;
            lastError?: string;
            livemode?: boolean;
            processedAt: number;
            status: "processing" | "processed" | "failed" | "ignored";
            stripeEventId: string;
          }>,
          Name
        >;
      };
    };
  };
