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
            status: string;
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
          any,
          Name
        >;
        getCheckoutSession: FunctionReference<
          "query",
          "internal",
          { sessionId: string },
          any,
          Name
        >;
        getCheckoutSessionByStripeId: FunctionReference<
          "query",
          "internal",
          { stripeSessionId: string },
          any,
          Name
        >;
        getInvoiceByStripeId: FunctionReference<
          "query",
          "internal",
          { stripeInvoiceId: string },
          any,
          Name
        >;
        getSubscription: FunctionReference<
          "query",
          "internal",
          { subscriptionId: string },
          any,
          Name
        >;
        getSubscriptionByStripeId: FunctionReference<
          "query",
          "internal",
          { stripeSubscriptionId: string },
          any,
          Name
        >;
        getTrialStatus: FunctionReference<
          "query",
          "internal",
          { subscriptionId: string },
          any,
          Name
        >;
        listCheckoutSessionsByUser: FunctionReference<
          "query",
          "internal",
          { limit?: number; status?: string; userId: string },
          any,
          Name
        >;
        listInvoices: FunctionReference<
          "query",
          "internal",
          {
            limit?: number;
            status?: string;
            subscriptionId?: string;
            userId?: string;
          },
          any,
          Name
        >;
        listSubscriptions: FunctionReference<
          "query",
          "internal",
          { limit?: number; status?: string },
          any,
          Name
        >;
        listSubscriptionsByOrg: FunctionReference<
          "query",
          "internal",
          { orgId: string; status?: string },
          any,
          Name
        >;
        listSubscriptionsByUser: FunctionReference<
          "query",
          "internal",
          { status?: string; userId: string },
          any,
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
          any,
          Name
        >;
        getPayout: FunctionReference<
          "query",
          "internal",
          { payoutId: string },
          any,
          Name
        >;
        getPayoutByStripeId: FunctionReference<
          "query",
          "internal",
          { stripePayoutId: string },
          any,
          Name
        >;
        listPayouts: FunctionReference<
          "query",
          "internal",
          { accountId?: string; limit?: number; status?: string },
          any,
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
          any,
          Name
        >;
        getAccountByOrgId: FunctionReference<
          "query",
          "internal",
          { orgId: string },
          any,
          Name
        >;
        getAccountByStripeId: FunctionReference<
          "query",
          "internal",
          { stripeAccountId: string },
          any,
          Name
        >;
        getAccountByUserId: FunctionReference<
          "query",
          "internal",
          { userId: string },
          any,
          Name
        >;
        getAccountOnboardingStatus: FunctionReference<
          "query",
          "internal",
          { accountId: string },
          any,
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
          any,
          Name
        >;
        getPriceByStripeId: FunctionReference<
          "query",
          "internal",
          { stripePriceId: string },
          any,
          Name
        >;
        getProduct: FunctionReference<
          "query",
          "internal",
          { productId: string },
          any,
          Name
        >;
        getProductByStripeId: FunctionReference<
          "query",
          "internal",
          { stripeProductId: string },
          any,
          Name
        >;
        listPrices: FunctionReference<
          "query",
          "internal",
          { active?: boolean; limit?: number; productId?: string },
          any,
          Name
        >;
        listPricesByProduct: FunctionReference<
          "query",
          "internal",
          { stripeProductId: string },
          any,
          Name
        >;
        listProducts: FunctionReference<
          "query",
          "internal",
          { accountId?: string; active?: boolean; limit?: number },
          any,
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
          any,
          Name
        >;
        listWebhookEvents: FunctionReference<
          "query",
          "internal",
          { eventType?: string; limit?: number; status?: string },
          any,
          Name
        >;
      };
    };
  };
