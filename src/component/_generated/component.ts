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
            applicationFeeAmount?: number;
            applicationFeePercent?: number;
            chargeType?: "destination" | "separate";
            clientSecret?: string;
            currency?: string;
            destinationAccountId?: string;
            feeCollectedAmount?: number;
            feeRefundedAmount?: number;
            metadata?: any;
            mode: "payment" | "subscription" | "setup";
            orgId?: string;
            priceId?: string;
            splitRecipients?: Array<{
              amount?: number;
              destinationAccountId: string;
              percent?: number;
              role: "store" | "affiliate" | "other";
            }>;
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
            applicationFeeAmount?: number;
            applicationFeePercent?: number;
            attemptCount?: number;
            chargeType?: "destination" | "separate";
            currency: string;
            destinationAccountId?: string;
            feeCollectedAmount?: number;
            feeRefundedAmount?: number;
            hostedInvoiceUrl?: string;
            invoicePdf?: string;
            metadata?: any;
            nextPaymentAttempt?: string;
            orgId?: string;
            periodEnd?: string;
            periodStart?: string;
            splitRecipients?: Array<{
              amount?: number;
              destinationAccountId: string;
              percent?: number;
              role: "store" | "affiliate" | "other";
            }>;
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
            applicationFeeAmount?: number;
            applicationFeePercent?: number;
            cancelAtPeriodEnd: boolean;
            canceledAt?: string;
            chargeType?: "destination" | "separate";
            currency?: string;
            currentPeriodEnd?: string;
            currentPeriodStart?: string;
            destinationAccountId?: string;
            feeCollectedAmount?: number;
            feeRefundedAmount?: number;
            isTrialing: boolean;
            metadata?: any;
            orgId?: string;
            priceId?: string;
            quantity?: number;
            splitRecipients?: Array<{
              amount?: number;
              destinationAccountId: string;
              percent?: number;
              role: "store" | "affiliate" | "other";
            }>;
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
          { destinationAccountId?: string; orgId?: string; userId: string },
          {
            _creationTime: number;
            _id: string;
            accountId?: string;
            applicationFeeAmount?: number;
            applicationFeePercent?: number;
            cancelAtPeriodEnd: boolean;
            canceledAt?: string;
            chargeType?: "destination" | "separate";
            currency?: string;
            currentPeriodEnd?: string;
            currentPeriodStart?: string;
            destinationAccountId?: string;
            feeCollectedAmount?: number;
            feeRefundedAmount?: number;
            isTrialing: boolean;
            metadata?: any;
            orgId?: string;
            priceId?: string;
            quantity?: number;
            splitRecipients?: Array<{
              amount?: number;
              destinationAccountId: string;
              percent?: number;
              role: "store" | "affiliate" | "other";
            }>;
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
            applicationFeeAmount?: number;
            applicationFeePercent?: number;
            chargeType?: "destination" | "separate";
            clientSecret?: string;
            currency?: string;
            destinationAccountId?: string;
            feeCollectedAmount?: number;
            feeRefundedAmount?: number;
            metadata?: any;
            mode: "payment" | "subscription" | "setup";
            orgId?: string;
            priceId?: string;
            splitRecipients?: Array<{
              amount?: number;
              destinationAccountId: string;
              percent?: number;
              role: "store" | "affiliate" | "other";
            }>;
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
            applicationFeeAmount?: number;
            applicationFeePercent?: number;
            chargeType?: "destination" | "separate";
            clientSecret?: string;
            currency?: string;
            destinationAccountId?: string;
            feeCollectedAmount?: number;
            feeRefundedAmount?: number;
            metadata?: any;
            mode: "payment" | "subscription" | "setup";
            orgId?: string;
            priceId?: string;
            splitRecipients?: Array<{
              amount?: number;
              destinationAccountId: string;
              percent?: number;
              role: "store" | "affiliate" | "other";
            }>;
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
            applicationFeeAmount?: number;
            applicationFeePercent?: number;
            attemptCount?: number;
            chargeType?: "destination" | "separate";
            currency: string;
            destinationAccountId?: string;
            feeCollectedAmount?: number;
            feeRefundedAmount?: number;
            hostedInvoiceUrl?: string;
            invoicePdf?: string;
            metadata?: any;
            nextPaymentAttempt?: string;
            orgId?: string;
            periodEnd?: string;
            periodStart?: string;
            splitRecipients?: Array<{
              amount?: number;
              destinationAccountId: string;
              percent?: number;
              role: "store" | "affiliate" | "other";
            }>;
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
            applicationFeeAmount?: number;
            applicationFeePercent?: number;
            cancelAtPeriodEnd: boolean;
            canceledAt?: string;
            chargeType?: "destination" | "separate";
            currency?: string;
            currentPeriodEnd?: string;
            currentPeriodStart?: string;
            destinationAccountId?: string;
            feeCollectedAmount?: number;
            feeRefundedAmount?: number;
            isTrialing: boolean;
            metadata?: any;
            orgId?: string;
            priceId?: string;
            quantity?: number;
            splitRecipients?: Array<{
              amount?: number;
              destinationAccountId: string;
              percent?: number;
              role: "store" | "affiliate" | "other";
            }>;
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
            applicationFeeAmount?: number;
            applicationFeePercent?: number;
            cancelAtPeriodEnd: boolean;
            canceledAt?: string;
            chargeType?: "destination" | "separate";
            currency?: string;
            currentPeriodEnd?: string;
            currentPeriodStart?: string;
            destinationAccountId?: string;
            feeCollectedAmount?: number;
            feeRefundedAmount?: number;
            isTrialing: boolean;
            metadata?: any;
            orgId?: string;
            priceId?: string;
            quantity?: number;
            splitRecipients?: Array<{
              amount?: number;
              destinationAccountId: string;
              percent?: number;
              role: "store" | "affiliate" | "other";
            }>;
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
            applicationFeeAmount?: number;
            applicationFeePercent?: number;
            chargeType?: "destination" | "separate";
            clientSecret?: string;
            currency?: string;
            destinationAccountId?: string;
            feeCollectedAmount?: number;
            feeRefundedAmount?: number;
            metadata?: any;
            mode: "payment" | "subscription" | "setup";
            orgId?: string;
            priceId?: string;
            splitRecipients?: Array<{
              amount?: number;
              destinationAccountId: string;
              percent?: number;
              role: "store" | "affiliate" | "other";
            }>;
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
            applicationFeeAmount?: number;
            applicationFeePercent?: number;
            attemptCount?: number;
            chargeType?: "destination" | "separate";
            currency: string;
            destinationAccountId?: string;
            feeCollectedAmount?: number;
            feeRefundedAmount?: number;
            hostedInvoiceUrl?: string;
            invoicePdf?: string;
            metadata?: any;
            nextPaymentAttempt?: string;
            orgId?: string;
            periodEnd?: string;
            periodStart?: string;
            splitRecipients?: Array<{
              amount?: number;
              destinationAccountId: string;
              percent?: number;
              role: "store" | "affiliate" | "other";
            }>;
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
            applicationFeeAmount?: number;
            applicationFeePercent?: number;
            cancelAtPeriodEnd: boolean;
            canceledAt?: string;
            chargeType?: "destination" | "separate";
            currency?: string;
            currentPeriodEnd?: string;
            currentPeriodStart?: string;
            destinationAccountId?: string;
            feeCollectedAmount?: number;
            feeRefundedAmount?: number;
            isTrialing: boolean;
            metadata?: any;
            orgId?: string;
            priceId?: string;
            quantity?: number;
            splitRecipients?: Array<{
              amount?: number;
              destinationAccountId: string;
              percent?: number;
              role: "store" | "affiliate" | "other";
            }>;
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
            applicationFeeAmount?: number;
            applicationFeePercent?: number;
            cancelAtPeriodEnd: boolean;
            canceledAt?: string;
            chargeType?: "destination" | "separate";
            currency?: string;
            currentPeriodEnd?: string;
            currentPeriodStart?: string;
            destinationAccountId?: string;
            feeCollectedAmount?: number;
            feeRefundedAmount?: number;
            isTrialing: boolean;
            metadata?: any;
            orgId?: string;
            priceId?: string;
            quantity?: number;
            splitRecipients?: Array<{
              amount?: number;
              destinationAccountId: string;
              percent?: number;
              role: "store" | "affiliate" | "other";
            }>;
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
            applicationFeeAmount?: number;
            applicationFeePercent?: number;
            cancelAtPeriodEnd: boolean;
            canceledAt?: string;
            chargeType?: "destination" | "separate";
            currency?: string;
            currentPeriodEnd?: string;
            currentPeriodStart?: string;
            destinationAccountId?: string;
            feeCollectedAmount?: number;
            feeRefundedAmount?: number;
            isTrialing: boolean;
            metadata?: any;
            orgId?: string;
            priceId?: string;
            quantity?: number;
            splitRecipients?: Array<{
              amount?: number;
              destinationAccountId: string;
              percent?: number;
              role: "store" | "affiliate" | "other";
            }>;
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
        listSubscriptionsByUserAndStore: FunctionReference<
          "query",
          "internal",
          {
            destinationAccountId: string;
            status?:
              | "active"
              | "trialing"
              | "past_due"
              | "canceled"
              | "incomplete"
              | "incomplete_expired"
              | "unpaid"
              | "paused";
            userId: string;
          },
          Array<{
            _creationTime: number;
            _id: string;
            accountId?: string;
            applicationFeeAmount?: number;
            applicationFeePercent?: number;
            cancelAtPeriodEnd: boolean;
            canceledAt?: string;
            chargeType?: "destination" | "separate";
            currency?: string;
            currentPeriodEnd?: string;
            currentPeriodStart?: string;
            destinationAccountId?: string;
            feeCollectedAmount?: number;
            feeRefundedAmount?: number;
            isTrialing: boolean;
            metadata?: any;
            orgId?: string;
            priceId?: string;
            quantity?: number;
            splitRecipients?: Array<{
              amount?: number;
              destinationAccountId: string;
              percent?: number;
              role: "store" | "affiliate" | "other";
            }>;
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
        claimReversalSlices: FunctionReference<
          "mutation",
          "internal",
          {
            mode:
              | { kind: "full" }
              | { kind: "percent"; percent: number }
              | { amount: number; kind: "amount" }
              | {
                  amountRefunded: number;
                  chargeAmount: number;
                  kind: "fraction";
                };
            operationId: string;
            sourceChargeId: string;
          },
          {
            replay: boolean;
            slices: Array<{
              confirmed: number;
              from: number;
              stripeTransferId: string;
              to: number;
            }>;
          },
          Name
        >;
        recordPaymentFeeRefund: FunctionReference<
          "mutation",
          "internal",
          {
            feeCollectedAmount: number;
            feeRefundedAmount: number;
            stripePaymentIntentId: string;
          },
          null,
          Name
        >;
        recordTransferReversal: FunctionReference<
          "mutation",
          "internal",
          { reversedAmount: number; stripeTransferId: string },
          null,
          Name
        >;
        releaseReversalClaim: FunctionReference<
          "mutation",
          "internal",
          {
            operationId: string;
            verified: Array<{
              amountReversed: number;
              stripeTransferId: string;
            }>;
          },
          {
            released: boolean;
            rewound: Array<{ stripeTransferId: string; to: number }>;
          },
          Name
        >;
        upsertDispute: FunctionReference<
          "mutation",
          "internal",
          {
            accountId?: string;
            amount: number;
            currency: string;
            evidence?: any;
            evidenceDueBy?: string;
            isChargeRefundable: boolean;
            lastEvent?: string;
            linkedTransferIds?: Array<string>;
            metadata?: any;
            reason: string;
            statementDescriptor?: string;
            status:
              | "warning_needs_response"
              | "warning_under_review"
              | "warning_closed"
              | "needs_response"
              | "under_review"
              | "won"
              | "lost"
              | "prevented";
            stripeChargeId?: string;
            stripeDisputeId: string;
            stripePaymentIntentId?: string;
          },
          null,
          Name
        >;
        upsertPayment: FunctionReference<
          "mutation",
          "internal",
          {
            accountId?: string;
            amount: number;
            applicationFeeAmount?: number;
            applicationFeePercent?: number;
            chargeType?: "destination" | "separate";
            currency: string;
            destinationAccountId?: string;
            feeCollectedAmount?: number;
            feeRefundedAmount?: number;
            metadata?: any;
            orgId?: string;
            splitRecipients?: Array<{
              amount?: number;
              destinationAccountId: string;
              percent?: number;
              role: "store" | "affiliate" | "other";
            }>;
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
        upsertRefund: FunctionReference<
          "mutation",
          "internal",
          {
            accountId?: string;
            amount: number;
            currency: string;
            failureReason?: string;
            metadata?: any;
            reason?:
              | "duplicate"
              | "fraudulent"
              | "requested_by_customer"
              | "expired_uncaptured_charge";
            status:
              | "pending"
              | "requires_action"
              | "succeeded"
              | "failed"
              | "canceled";
            stripeChargeId?: string;
            stripePaymentIntentId?: string;
            stripeRefundId: string;
          },
          null,
          Name
        >;
        upsertTransfer: FunctionReference<
          "mutation",
          "internal",
          {
            amount: number;
            currency: string;
            destinationAccountId: string;
            metadata?: any;
            paymentId?: string;
            reinstatement?: boolean;
            reversalStatus?: "partially_reversed" | "fully_reversed";
            reversedAmount?: number;
            role?: "store" | "affiliate" | "other";
            sourceChargeId?: string;
            sourceInvoiceId?: string;
            status: "pending" | "paid" | "failed" | "reversed";
            stripeTransferId: string;
          },
          null,
          Name
        >;
      };
      queries: {
        getAccountEarnings: FunctionReference<
          "query",
          "internal",
          { destinationAccountId: string; previewLimit?: number },
          {
            gross: number;
            reversed: number;
            transferCount: number;
            transfers: Array<{
              _creationTime: number;
              _id: string;
              amount: number;
              currency: string;
              destinationAccountId: string;
              metadata?: any;
              paymentId?: string;
              reinstatement?: boolean;
              reversalClaimedAmount?: number;
              reversalStatus?: "partially_reversed" | "fully_reversed";
              reversedAmount?: number;
              role?: "store" | "affiliate" | "other";
              sourceChargeId?: string;
              sourceInvoiceId?: string;
              status: "pending" | "paid" | "failed" | "reversed";
              stripeTransferId: string;
            }>;
          },
          Name
        >;
        getAccountPayouts: FunctionReference<
          "query",
          "internal",
          { accountId: string; previewLimit?: number },
          {
            paidOut: number;
            payoutCount: number;
            payouts: Array<{
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
            }>;
          },
          Name
        >;
        getDisputeByStripeId: FunctionReference<
          "query",
          "internal",
          { stripeDisputeId: string },
          {
            _creationTime: number;
            _id: string;
            accountId?: string;
            amount: number;
            currency: string;
            evidence?: any;
            evidenceDueBy?: string;
            isChargeRefundable: boolean;
            lastEvent?: string;
            linkedTransferIds?: Array<string>;
            metadata?: any;
            reason: string;
            statementDescriptor?: string;
            status:
              | "warning_needs_response"
              | "warning_under_review"
              | "warning_closed"
              | "needs_response"
              | "under_review"
              | "won"
              | "lost"
              | "prevented";
            stripeChargeId?: string;
            stripeDisputeId: string;
            stripePaymentIntentId?: string;
          } | null,
          Name
        >;
        getPaymentByStripeId: FunctionReference<
          "query",
          "internal",
          { stripePaymentIntentId: string },
          {
            _creationTime: number;
            _id: string;
            accountId?: string;
            amount: number;
            applicationFeeAmount?: number;
            applicationFeePercent?: number;
            chargeType?: "destination" | "separate";
            currency: string;
            destinationAccountId?: string;
            feeCollectedAmount?: number;
            feeRefundedAmount?: number;
            metadata?: any;
            orgId?: string;
            refundStatus?: "partially_refunded" | "fully_refunded";
            refundedAmount?: number;
            splitRecipients?: Array<{
              amount?: number;
              destinationAccountId: string;
              percent?: number;
              role: "store" | "affiliate" | "other";
            }>;
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
        getRefundByStripeId: FunctionReference<
          "query",
          "internal",
          { stripeRefundId: string },
          {
            _creationTime: number;
            _id: string;
            accountId?: string;
            amount: number;
            currency: string;
            failureReason?: string;
            metadata?: any;
            reason?:
              | "duplicate"
              | "fraudulent"
              | "requested_by_customer"
              | "expired_uncaptured_charge";
            status:
              | "pending"
              | "requires_action"
              | "succeeded"
              | "failed"
              | "canceled";
            stripeChargeId?: string;
            stripePaymentIntentId?: string;
            stripeRefundId: string;
          } | null,
          Name
        >;
        getReversalOp: FunctionReference<
          "query",
          "internal",
          { operationId: string },
          {
            _creationTime: number;
            _id: string;
            operationId: string;
            slices: Array<{
              from: number;
              stripeTransferId: string;
              to: number;
            }>;
            sourceChargeId: string;
          } | null,
          Name
        >;
        getTransferByStripeId: FunctionReference<
          "query",
          "internal",
          { stripeTransferId: string },
          {
            _creationTime: number;
            _id: string;
            amount: number;
            currency: string;
            destinationAccountId: string;
            metadata?: any;
            paymentId?: string;
            reinstatement?: boolean;
            reversalClaimedAmount?: number;
            reversalStatus?: "partially_reversed" | "fully_reversed";
            reversedAmount?: number;
            role?: "store" | "affiliate" | "other";
            sourceChargeId?: string;
            sourceInvoiceId?: string;
            status: "pending" | "paid" | "failed" | "reversed";
            stripeTransferId: string;
          } | null,
          Name
        >;
        listDisputes: FunctionReference<
          "query",
          "internal",
          {
            accountId?: string;
            limit?: number;
            status?:
              | "warning_needs_response"
              | "warning_under_review"
              | "warning_closed"
              | "needs_response"
              | "under_review"
              | "won"
              | "lost"
              | "prevented";
            stripePaymentIntentId?: string;
          },
          Array<{
            _creationTime: number;
            _id: string;
            accountId?: string;
            amount: number;
            currency: string;
            evidence?: any;
            evidenceDueBy?: string;
            isChargeRefundable: boolean;
            lastEvent?: string;
            linkedTransferIds?: Array<string>;
            metadata?: any;
            reason: string;
            statementDescriptor?: string;
            status:
              | "warning_needs_response"
              | "warning_under_review"
              | "warning_closed"
              | "needs_response"
              | "under_review"
              | "won"
              | "lost"
              | "prevented";
            stripeChargeId?: string;
            stripeDisputeId: string;
            stripePaymentIntentId?: string;
          }>,
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
        listRefunds: FunctionReference<
          "query",
          "internal",
          {
            accountId?: string;
            limit?: number;
            status?:
              | "pending"
              | "requires_action"
              | "succeeded"
              | "failed"
              | "canceled";
            stripePaymentIntentId?: string;
          },
          Array<{
            _creationTime: number;
            _id: string;
            accountId?: string;
            amount: number;
            currency: string;
            failureReason?: string;
            metadata?: any;
            reason?:
              | "duplicate"
              | "fraudulent"
              | "requested_by_customer"
              | "expired_uncaptured_charge";
            status:
              | "pending"
              | "requires_action"
              | "succeeded"
              | "failed"
              | "canceled";
            stripeChargeId?: string;
            stripePaymentIntentId?: string;
            stripeRefundId: string;
          }>,
          Name
        >;
        listTransfersByAccount: FunctionReference<
          "query",
          "internal",
          { destinationAccountId: string; limit?: number },
          Array<{
            _creationTime: number;
            _id: string;
            amount: number;
            currency: string;
            destinationAccountId: string;
            metadata?: any;
            paymentId?: string;
            reinstatement?: boolean;
            reversalClaimedAmount?: number;
            reversalStatus?: "partially_reversed" | "fully_reversed";
            reversedAmount?: number;
            role?: "store" | "affiliate" | "other";
            sourceChargeId?: string;
            sourceInvoiceId?: string;
            status: "pending" | "paid" | "failed" | "reversed";
            stripeTransferId: string;
          }>,
          Name
        >;
        listTransfersByCharge: FunctionReference<
          "query",
          "internal",
          { limit?: number; sourceChargeId: string },
          Array<{
            _creationTime: number;
            _id: string;
            amount: number;
            currency: string;
            destinationAccountId: string;
            metadata?: any;
            paymentId?: string;
            reinstatement?: boolean;
            reversalClaimedAmount?: number;
            reversalStatus?: "partially_reversed" | "fully_reversed";
            reversedAmount?: number;
            role?: "store" | "affiliate" | "other";
            sourceChargeId?: string;
            sourceInvoiceId?: string;
            status: "pending" | "paid" | "failed" | "reversed";
            stripeTransferId: string;
          }>,
          Name
        >;
        listWedgedReversalClaims: FunctionReference<
          "query",
          "internal",
          {},
          Array<{
            amount: number;
            blockingOps: Array<{
              from: number;
              operationId: string;
              to: number;
            }>;
            reversalClaimedAmount: number;
            reversedAmount: number;
            sourceChargeId?: string;
            stripeTransferId: string;
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
        setStatementDescriptor: FunctionReference<
          "mutation",
          "internal",
          { statementDescriptor: string | null; stripeAccountId: string },
          null,
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
            statementDescriptor?: string;
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
            statementDescriptor?: string;
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
            statementDescriptor?: string;
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
            statementDescriptor?: string;
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
