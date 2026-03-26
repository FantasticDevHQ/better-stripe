/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as actions from "../actions.js";
import type * as courses from "../courses.js";
import type * as http from "../http.js";
import type * as queries from "../queries.js";
import type * as reset from "../reset.js";
import type * as seed from "../seed.js";
import type * as setup from "../setup.js";
import type * as stripe from "../stripe.js";
import type * as users from "../users.js";
import type * as webhookLog from "../webhookLog.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  actions: typeof actions;
  courses: typeof courses;
  http: typeof http;
  queries: typeof queries;
  reset: typeof reset;
  seed: typeof seed;
  setup: typeof setup;
  stripe: typeof stripe;
  users: typeof users;
  webhookLog: typeof webhookLog;
}> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
> = anyApi as any;

export const components = componentsGeneric() as unknown as {
  betterStripe: {
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
          null
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
          null
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
          null
        >;
      };
      queries: {
        getActiveSubscription: FunctionReference<
          "query",
          "internal",
          { orgId?: string; userId: string },
          any
        >;
        getCheckoutSession: FunctionReference<
          "query",
          "internal",
          { sessionId: string },
          any
        >;
        getCheckoutSessionByStripeId: FunctionReference<
          "query",
          "internal",
          { stripeSessionId: string },
          any
        >;
        getSubscription: FunctionReference<
          "query",
          "internal",
          { subscriptionId: string },
          any
        >;
        getSubscriptionByStripeId: FunctionReference<
          "query",
          "internal",
          { stripeSubscriptionId: string },
          any
        >;
        getTrialStatus: FunctionReference<
          "query",
          "internal",
          { subscriptionId: string },
          any
        >;
        listCheckoutSessionsByUser: FunctionReference<
          "query",
          "internal",
          { limit?: number; status?: string; userId: string },
          any
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
          any
        >;
        listSubscriptions: FunctionReference<
          "query",
          "internal",
          { limit?: number; status?: string },
          any
        >;
        listSubscriptionsByOrg: FunctionReference<
          "query",
          "internal",
          { orgId: string; status?: string },
          any
        >;
        listSubscriptionsByUser: FunctionReference<
          "query",
          "internal",
          { status?: string; userId: string },
          any
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
          null
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
          null
        >;
      };
      queries: {
        getPayout: FunctionReference<
          "query",
          "internal",
          { payoutId: string },
          any
        >;
        listPayouts: FunctionReference<
          "query",
          "internal",
          { accountId?: string; limit?: number; status?: string },
          any
        >;
      };
    };
    core: {
      mutations: {
        clearAllTables: FunctionReference<
          "mutation",
          "internal",
          {},
          { cleared: number; tables: Array<string> }
        >;
        deleteAccountByStripeId: FunctionReference<
          "mutation",
          "internal",
          { stripeAccountId: string },
          boolean
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
          null
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
          null
        >;
      };
      queries: {
        getAccount: FunctionReference<
          "query",
          "internal",
          { accountId: string },
          any
        >;
        getAccountByOrgId: FunctionReference<
          "query",
          "internal",
          { orgId: string },
          any
        >;
        getAccountByStripeId: FunctionReference<
          "query",
          "internal",
          { stripeAccountId: string },
          any
        >;
        getAccountByUserId: FunctionReference<
          "query",
          "internal",
          { userId: string },
          any
        >;
        getAccountOnboardingStatus: FunctionReference<
          "query",
          "internal",
          { accountId: string },
          any
        >;
        getPublishableKey: FunctionReference<
          "query",
          "internal",
          {},
          string | null
        >;
        getStripeMode: FunctionReference<
          "query",
          "internal",
          {},
          "test" | "live"
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
          null
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
          null
        >;
      };
      queries: {
        getPrice: FunctionReference<
          "query",
          "internal",
          { priceId: string },
          any
        >;
        getPriceByStripeId: FunctionReference<
          "query",
          "internal",
          { stripePriceId: string },
          any
        >;
        getProduct: FunctionReference<
          "query",
          "internal",
          { productId: string },
          any
        >;
        getProductByStripeId: FunctionReference<
          "query",
          "internal",
          { stripeProductId: string },
          any
        >;
        listPrices: FunctionReference<
          "query",
          "internal",
          { active?: boolean; limit?: number; productId?: string },
          any
        >;
        listPricesByProduct: FunctionReference<
          "query",
          "internal",
          { stripeProductId: string },
          any
        >;
        listProducts: FunctionReference<
          "query",
          "internal",
          { accountId?: string; active?: boolean; limit?: number },
          any
        >;
      };
    };
    webhooks: {
      mutations: {
        insertWebhookEvent: FunctionReference<
          "mutation",
          "internal",
          { eventType: string; livemode?: boolean; stripeEventId: string },
          "inserted" | "processing" | "processed" | "failed" | "ignored"
        >;
        markWebhookEventFailed: FunctionReference<
          "mutation",
          "internal",
          { error: string; stripeEventId: string },
          null
        >;
        markWebhookEventIgnored: FunctionReference<
          "mutation",
          "internal",
          { stripeEventId: string },
          null
        >;
        markWebhookEventProcessed: FunctionReference<
          "mutation",
          "internal",
          { stripeEventId: string },
          null
        >;
      };
      queries: {
        getWebhookEvent: FunctionReference<
          "query",
          "internal",
          { stripeEventId: string },
          any
        >;
      };
    };
  };
};
