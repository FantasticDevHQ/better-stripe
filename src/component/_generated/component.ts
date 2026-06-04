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
 *   return ctx.runQuery(component.core.queries.getAccount, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    core: {
      queries: {
        getAccount: FunctionReference<
          "query",
          "internal",
          { accountId: string },
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
        getAccountByOrgId: FunctionReference<
          "query",
          "internal",
          { orgId: string },
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
      mutations: {
        upsertAccount: FunctionReference<
          "mutation",
          "internal",
          {
            stripeAccountId: string;
            userId: string;
            orgId?: string;
            email?: string;
            name?: string;
            country?: string;
            capabilities?: any;
            requirements?: any;
            configuration?: any;
            appliedConfigurations?: Array<
              "customer" | "merchant" | "recipient"
            >;
            onboardingStatus?:
              | "pending"
              | "in_progress"
              | "complete"
              | "restricted";
            missingRequirements?: Array<string>;
            metadata?: any;
          },
          null,
          Name
        >;
        deleteAccountByStripeId: FunctionReference<
          "mutation",
          "internal",
          { stripeAccountId: string },
          boolean,
          Name
        >;
        upsertAccountInternal: FunctionReference<
          "mutation",
          "internal",
          {
            stripeAccountId: string;
            userId: string;
            orgId?: string;
            email?: string;
            name?: string;
            country?: string;
            capabilities?: any;
            requirements?: any;
            configuration?: any;
            appliedConfigurations?: Array<
              "customer" | "merchant" | "recipient"
            >;
            onboardingStatus:
              | "pending"
              | "in_progress"
              | "complete"
              | "restricted";
            missingRequirements?: Array<string>;
            metadata?: any;
          },
          null,
          Name
        >;
        clearAllTables: FunctionReference<
          "mutation",
          "internal",
          {},
          { cleared: number; tables: Array<string> },
          Name
        >;
      };
    };
    products: {
      queries: {
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
        listProducts: FunctionReference<
          "query",
          "internal",
          { accountId?: string; active?: boolean; limit?: number },
          any,
          Name
        >;
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
        listPrices: FunctionReference<
          "query",
          "internal",
          { productId?: string; active?: boolean; limit?: number },
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
      };
      mutations: {
        upsertProduct: FunctionReference<
          "mutation",
          "internal",
          {
            stripeProductId: string;
            accountId?: string;
            name: string;
            description?: string;
            active: boolean;
            metadata?: any;
          },
          null,
          Name
        >;
        upsertPrice: FunctionReference<
          "mutation",
          "internal",
          {
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
            metadata?: any;
          },
          null,
          Name
        >;
      };
    };
    billing: {
      queries: {
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
        listSubscriptions: FunctionReference<
          "query",
          "internal",
          { status?: string; limit?: number },
          any,
          Name
        >;
        listSubscriptionsByUser: FunctionReference<
          "query",
          "internal",
          { userId: string; status?: string },
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
        getActiveSubscription: FunctionReference<
          "query",
          "internal",
          { userId: string; orgId?: string },
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
        listCheckoutSessionsByUser: FunctionReference<
          "query",
          "internal",
          { userId: string; status?: string; limit?: number },
          any,
          Name
        >;
        listInvoices: FunctionReference<
          "query",
          "internal",
          {
            userId?: string;
            subscriptionId?: string;
            status?: string;
            limit?: number;
          },
          any,
          Name
        >;
      };
      mutations: {
        upsertSubscription: FunctionReference<
          "mutation",
          "internal",
          {
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
              | "incomplete_expired"
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
            metadata?: any;
          },
          null,
          Name
        >;
        upsertCheckoutSession: FunctionReference<
          "mutation",
          "internal",
          {
            stripeSessionId: string;
            userId: string;
            orgId?: string;
            accountId?: string;
            mode: "payment" | "subscription" | "setup";
            status: "open" | "complete" | "expired";
            clientSecret?: string;
            url?: string;
            priceId?: string;
            metadata?: any;
          },
          null,
          Name
        >;
        upsertInvoice: FunctionReference<
          "mutation",
          "internal",
          {
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
            metadata?: any;
          },
          null,
          Name
        >;
      };
    };
    connect: {
      queries: {
        getPayout: FunctionReference<
          "query",
          "internal",
          { payoutId: string },
          any,
          Name
        >;
        listPayouts: FunctionReference<
          "query",
          "internal",
          { accountId?: string; status?: string; limit?: number },
          any,
          Name
        >;
      };
      mutations: {
        upsertPayment: FunctionReference<
          "mutation",
          "internal",
          {
            stripePaymentIntentId: string;
            userId: string;
            orgId?: string;
            accountId?: string;
            amount: number;
            currency: string;
            status:
              | "succeeded"
              | "failed"
              | "canceled"
              | "processing"
              | "requires_action";
            metadata?: any;
          },
          null,
          Name
        >;
        upsertPayout: FunctionReference<
          "mutation",
          "internal",
          {
            stripePayoutId: string;
            accountId: string;
            amount: number;
            currency: string;
            status: "pending" | "paid" | "failed" | "canceled" | "in_transit";
            arrivalDate?: string;
            method?: string;
            metadata?: any;
          },
          null,
          Name
        >;
      };
    };
    webhooks: {
      queries: {
        getWebhookEvent: FunctionReference<
          "query",
          "internal",
          { stripeEventId: string },
          any,
          Name
        >;
      };
      mutations: {
        insertWebhookEvent: FunctionReference<
          "mutation",
          "internal",
          {
            stripeEventId: string;
            eventType: string;
            livemode?: boolean;
          },
          "inserted" | "processing" | "processed" | "failed" | "ignored",
          Name
        >;
        markWebhookEventProcessed: FunctionReference<
          "mutation",
          "internal",
          { stripeEventId: string },
          null,
          Name
        >;
        markWebhookEventFailed: FunctionReference<
          "mutation",
          "internal",
          {
            stripeEventId: string;
            error: string;
          },
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
      };
    };
  };
