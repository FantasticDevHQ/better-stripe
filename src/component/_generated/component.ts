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
    affiliateEarnings: {
      mutations: {
        confirmEarning: FunctionReference<
          "mutation",
          "internal",
          { earningId: string; stripeTransferId?: string },
          null,
          Name
        >;
        reserveEarning: FunctionReference<
          "mutation",
          "internal",
          { affiliateAccountId: string; sourceChargeId: string },
          {
            _creationTime: number;
            _id: string;
            affiliateAccountId: string;
            currency: string;
            originalCommission: number;
            paymentIntentId?: string;
            releaseAmount: number;
            sourceChargeId: string;
            sourceInvoiceId?: string;
            status: "reserved" | "paid";
            stripeTransferId?: string;
            withheldAmount: number;
          },
          Name
        >;
      };
    };
    affiliatePayouts: {
      mutations: {
        finishPayout: FunctionReference<
          "mutation",
          "internal",
          {
            operationKey: string;
            state: "unknown" | "submitted" | "failed";
            stripePayoutId?: string;
          },
          null,
          Name
        >;
        reservePayout: FunctionReference<
          "mutation",
          "internal",
          {
            affiliateAccountId: string;
            amount: number;
            currency: string;
            minimumAmount: number;
            now: number;
            operationKey?: string;
          },
          {
            _creationTime: number;
            _id: string;
            affiliateAccountId: string;
            amount: number;
            createdAt: number;
            currency: string;
            minimumAmount: number;
            operationKey: string;
            state: "pending" | "unknown" | "submitted" | "failed";
            stripePayoutId?: string;
          } | null,
          Name
        >;
      };
      queries: {
        pendingPayouts: FunctionReference<
          "query",
          "internal",
          {
            paginationOpts: {
              cursor: string | null;
              endCursor?: string | null;
              id?: number;
              maximumBytesRead?: number;
              maximumRowsRead?: number;
              numItems: number;
            };
            state: "pending" | "unknown";
          },
          {
            continueCursor: string;
            isDone: boolean;
            page: Array<{
              _creationTime: number;
              _id: string;
              affiliateAccountId: string;
              amount: number;
              createdAt: number;
              currency: string;
              minimumAmount: number;
              operationKey: string;
              state: "pending" | "unknown" | "submitted" | "failed";
              stripePayoutId?: string;
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
          },
          Name
        >;
      };
    };
    affiliateRecovery: {
      mutations: {
        beginOperation: FunctionReference<
          "mutation",
          "internal",
          { operationId: string },
          {
            _creationTime: number;
            _id: string;
            amount: number;
            attempted: boolean;
            createdAt: number;
            error?: string;
            kind: "recovery" | "restoration";
            obligationId: string;
            providerBaseline?: number;
            receiptId?: string;
            sourceEventId?: string;
            state:
              | "pending"
              | "unknown"
              | "insufficient_balance"
              | "unsupported"
              | "failed"
              | "succeeded"
              | "canceled";
          },
          Name
        >;
        completeOperation: FunctionReference<
          "mutation",
          "internal",
          {
            confirmedTransferReversed?: number;
            error?: string;
            operationId: string;
            receiptId?: string;
            state:
              | "pending"
              | "unknown"
              | "insufficient_balance"
              | "unsupported"
              | "failed"
              | "succeeded"
              | "canceled";
          },
          null,
          Name
        >;
        reserveOperation: FunctionReference<
          "mutation",
          "internal",
          {
            kind: "recovery" | "restoration";
            now: number;
            obligationId: string;
          },
          {
            _creationTime: number;
            _id: string;
            amount: number;
            attempted: boolean;
            createdAt: number;
            error?: string;
            kind: "recovery" | "restoration";
            obligationId: string;
            providerBaseline?: number;
            receiptId?: string;
            sourceEventId?: string;
            state:
              | "pending"
              | "unknown"
              | "insufficient_balance"
              | "unsupported"
              | "failed"
              | "succeeded"
              | "canceled";
          } | null,
          Name
        >;
        reviewLegacy: FunctionReference<
          "mutation",
          "internal",
          {
            exposure: {
              chargeAmount: number;
              disputeId?: string;
              disputeState?: "open" | "lost" | "won";
              finalized: boolean;
              kind: "refund" | "dispute";
              principal: number;
              refundId?: string;
              refundedPrincipal?: number;
            };
            note: string;
            obligationId: string;
            receipts: Array<{ amount: number; id: string }>;
            recoveredAmount: number;
            restorationIds: Array<string>;
            restoredAmount: number;
          },
          null,
          Name
        >;
      };
      queries: {
        chargeObligations: FunctionReference<
          "query",
          "internal",
          { sourceChargeId: string },
          Array<{
            _creationTime: number;
            _id: string;
            accounted?: boolean;
            activeOperationId?: string;
            affiliateAccountId: string;
            chargeAmount: number;
            creditAmount?: number;
            currency: string;
            debtAmount?: number;
            debtStatus?: "open" | "settled";
            disputeId?: string;
            disputeState?: "open" | "lost" | "won";
            disputedPrincipal: number;
            earningId?: string;
            finalizedAmount: number;
            lastError?: string;
            lastRefundId?: string;
            lastState?: string;
            legacyReceiptIds?: Array<string>;
            legacyRestorationIds?: Array<string>;
            lostPrincipal: number;
            needsReconciliation: boolean;
            offsetAmount?: number;
            operationSequence?: number;
            operatorNote?: string;
            originalCommission: number;
            paymentId?: string;
            paymentIntentId?: string;
            provisionalAmount: number;
            recoveredAmount: number;
            refundedPrincipal: number;
            releasedCommission?: number;
            reservedRecovery?: number;
            reservedRestoration?: number;
            restoredAmount?: number;
            sourceChargeId: string;
            sourceInvoiceId?: string;
            storeAccountId?: string;
            stripeTransferId?: string;
          }>,
          Name
        >;
        getEarning: FunctionReference<
          "query",
          "internal",
          { affiliateAccountId: string; sourceChargeId: string },
          {
            _creationTime: number;
            _id: string;
            affiliateAccountId: string;
            currency: string;
            originalCommission: number;
            paymentIntentId?: string;
            releaseAmount: number;
            sourceChargeId: string;
            sourceInvoiceId?: string;
            status: "reserved" | "paid";
            stripeTransferId?: string;
            withheldAmount: number;
          } | null,
          Name
        >;
        getObligation: FunctionReference<
          "query",
          "internal",
          { obligationId: string },
          {
            _creationTime: number;
            _id: string;
            accounted?: boolean;
            activeOperationId?: string;
            affiliateAccountId: string;
            chargeAmount: number;
            creditAmount?: number;
            currency: string;
            debtAmount?: number;
            debtStatus?: "open" | "settled";
            disputeId?: string;
            disputeState?: "open" | "lost" | "won";
            disputedPrincipal: number;
            earningId?: string;
            finalizedAmount: number;
            lastError?: string;
            lastRefundId?: string;
            lastState?: string;
            legacyReceiptIds?: Array<string>;
            legacyRestorationIds?: Array<string>;
            lostPrincipal: number;
            needsReconciliation: boolean;
            offsetAmount?: number;
            operationSequence?: number;
            operatorNote?: string;
            originalCommission: number;
            paymentId?: string;
            paymentIntentId?: string;
            provisionalAmount: number;
            recoveredAmount: number;
            refundedPrincipal: number;
            releasedCommission?: number;
            reservedRecovery?: number;
            reservedRestoration?: number;
            restoredAmount?: number;
            sourceChargeId: string;
            sourceInvoiceId?: string;
            storeAccountId?: string;
            stripeTransferId?: string;
          } | null,
          Name
        >;
        operationHistory: FunctionReference<
          "query",
          "internal",
          {
            obligationId: string;
            paginationOpts: {
              cursor: string | null;
              endCursor?: string | null;
              id?: number;
              maximumBytesRead?: number;
              maximumRowsRead?: number;
              numItems: number;
            };
          },
          {
            continueCursor: string;
            isDone: boolean;
            page: Array<{
              _creationTime: number;
              _id: string;
              amount: number;
              attempted: boolean;
              createdAt: number;
              error?: string;
              kind: "recovery" | "restoration";
              obligationId: string;
              providerBaseline?: number;
              receiptId?: string;
              sourceEventId?: string;
              state:
                | "pending"
                | "unknown"
                | "insufficient_balance"
                | "unsupported"
                | "failed"
                | "succeeded"
                | "canceled";
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
          },
          Name
        >;
        pendingOperations: FunctionReference<
          "query",
          "internal",
          {
            paginationOpts: {
              cursor: string | null;
              endCursor?: string | null;
              id?: number;
              maximumBytesRead?: number;
              maximumRowsRead?: number;
              numItems: number;
            };
            state: "pending" | "unknown";
          },
          {
            continueCursor: string;
            isDone: boolean;
            page: Array<{
              _creationTime: number;
              _id: string;
              amount: number;
              attempted: boolean;
              createdAt: number;
              error?: string;
              kind: "recovery" | "restoration";
              obligationId: string;
              providerBaseline?: number;
              receiptId?: string;
              sourceEventId?: string;
              state:
                | "pending"
                | "unknown"
                | "insufficient_balance"
                | "unsupported"
                | "failed"
                | "succeeded"
                | "canceled";
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
          },
          Name
        >;
        recoverySnapshot: FunctionReference<
          "query",
          "internal",
          {
            affiliateAccountId: string;
            currency: string;
            paginationOpts: {
              cursor: string | null;
              endCursor?: string | null;
              id?: number;
              maximumBytesRead?: number;
              maximumRowsRead?: number;
              numItems: number;
            };
          },
          {
            balance: {
              _creationTime: number;
              _id: string;
              activePayoutKey?: string;
              affiliateAccountId: string;
              currency: string;
              netPayable: number;
              offsetAmount: number;
              originalCommission: number;
              outstandingDebt: number;
              pendingPayoutAmount?: number;
              recoveredAmount: number;
              reservedRecovery: number;
              reservedRestoration: number;
              restorationDue: number;
              restoredAmount: number;
              withheldAmount: number;
            } | null;
            obligations: {
              continueCursor: string;
              isDone: boolean;
              page: Array<{
                _creationTime: number;
                _id: string;
                accounted?: boolean;
                activeOperationId?: string;
                affiliateAccountId: string;
                chargeAmount: number;
                creditAmount?: number;
                currency: string;
                debtAmount?: number;
                debtStatus?: "open" | "settled";
                disputeId?: string;
                disputeState?: "open" | "lost" | "won";
                disputedPrincipal: number;
                earningId?: string;
                finalizedAmount: number;
                lastError?: string;
                lastRefundId?: string;
                lastState?: string;
                legacyReceiptIds?: Array<string>;
                legacyRestorationIds?: Array<string>;
                lostPrincipal: number;
                needsReconciliation: boolean;
                offsetAmount?: number;
                operationSequence?: number;
                operatorNote?: string;
                originalCommission: number;
                paymentId?: string;
                paymentIntentId?: string;
                provisionalAmount: number;
                recoveredAmount: number;
                refundedPrincipal: number;
                releasedCommission?: number;
                reservedRecovery?: number;
                reservedRestoration?: number;
                restoredAmount?: number;
                sourceChargeId: string;
                sourceInvoiceId?: string;
                storeAccountId?: string;
                stripeTransferId?: string;
              }>;
              pageStatus?: "SplitRecommended" | "SplitRequired" | null;
              splitCursor?: string | null;
            };
          },
          Name
        >;
      };
    };
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
            isCollectionPaused?: boolean;
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
            isCollectionPaused?: boolean;
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
            isCollectionPaused?: boolean;
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
            isCollectionPaused?: boolean;
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
            isCollectionPaused?: boolean;
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
            isCollectionPaused?: boolean;
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
        listSubscriptionsByPrice: FunctionReference<
          "query",
          "internal",
          { priceId: string },
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
            isCollectionPaused?: boolean;
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
            isCollectionPaused?: boolean;
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
            isCollectionPaused?: boolean;
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
            commissionExposure?: {
              chargeAmount: number;
              disputeId?: string;
              disputeState?: "open" | "lost" | "won";
              finalized: boolean;
              kind: "refund" | "dispute";
              principal: number;
              refundId?: string;
              refundedPrincipal?: number;
            };
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
              commissionTracked?: boolean;
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
          {
            receipt?: {
              amount: number;
              operationId: string;
              stripeReversalId: string;
            };
            reversedAmount: number;
            stripeTransferId: string;
          },
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
            failureCode?: string;
            failureMessage?: string;
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
              totalsRecorded?: true;
            }>;
          },
          Name
        >;
        getAccountEarningsByCurrency: FunctionReference<
          "query",
          "internal",
          { destinationAccountId: string; previewLimit?: number },
          {
            totals: Array<{
              currency: string;
              gross: number;
              net: number;
              reversed: number;
              transferCount: number;
            }>;
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
              totalsRecorded?: true;
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
              failureCode?: string;
              failureMessage?: string;
              metadata?: any;
              method?: string;
              status: "pending" | "paid" | "failed" | "canceled" | "in_transit";
              stripePayoutId: string;
              totalsRecorded?: true;
            }>;
          },
          Name
        >;
        getAccountPayoutsByCurrency: FunctionReference<
          "query",
          "internal",
          { accountId: string; previewLimit?: number },
          {
            payouts: Array<{
              _creationTime: number;
              _id: string;
              accountId: string;
              amount: number;
              arrivalDate?: string;
              currency: string;
              failureCode?: string;
              failureMessage?: string;
              metadata?: any;
              method?: string;
              status: "pending" | "paid" | "failed" | "canceled" | "in_transit";
              stripePayoutId: string;
              totalsRecorded?: true;
            }>;
            totals: Array<{
              currency: string;
              paidOut: number;
              payoutCount: number;
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
            failureCode?: string;
            failureMessage?: string;
            metadata?: any;
            method?: string;
            status: "pending" | "paid" | "failed" | "canceled" | "in_transit";
            stripePayoutId: string;
            totalsRecorded?: true;
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
            failureCode?: string;
            failureMessage?: string;
            metadata?: any;
            method?: string;
            status: "pending" | "paid" | "failed" | "canceled" | "in_transit";
            stripePayoutId: string;
            totalsRecorded?: true;
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
            commissionExposure?: {
              chargeAmount: number;
              disputeId?: string;
              disputeState?: "open" | "lost" | "won";
              finalized: boolean;
              kind: "refund" | "dispute";
              principal: number;
              refundId?: string;
              refundedPrincipal?: number;
            };
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
            totalsRecorded?: true;
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
            failureCode?: string;
            failureMessage?: string;
            metadata?: any;
            method?: string;
            status: "pending" | "paid" | "failed" | "canceled" | "in_transit";
            stripePayoutId: string;
            totalsRecorded?: true;
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
            totalsRecorded?: true;
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
            totalsRecorded?: true;
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
        paginatePayouts: FunctionReference<
          "query",
          "internal",
          {
            accountId: string;
            paginationOpts: {
              cursor: string | null;
              endCursor?: string | null;
              id?: number;
              maximumBytesRead?: number;
              maximumRowsRead?: number;
              numItems: number;
            };
            status?: "pending" | "paid" | "failed" | "canceled" | "in_transit";
          },
          {
            continueCursor: string;
            isDone: boolean;
            page: Array<{
              _creationTime: number;
              _id: string;
              accountId: string;
              amount: number;
              arrivalDate?: string;
              currency: string;
              failureCode?: string;
              failureMessage?: string;
              metadata?: any;
              method?: string;
              status: "pending" | "paid" | "failed" | "canceled" | "in_transit";
              stripePayoutId: string;
              totalsRecorded?: true;
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
          },
          Name
        >;
        paginateTransfersByAccount: FunctionReference<
          "query",
          "internal",
          {
            destinationAccountId: string;
            paginationOpts: {
              cursor: string | null;
              endCursor?: string | null;
              id?: number;
              maximumBytesRead?: number;
              maximumRowsRead?: number;
              numItems: number;
            };
          },
          {
            continueCursor: string;
            isDone: boolean;
            page: Array<{
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
              totalsRecorded?: true;
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
          },
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
              "pending" | "in_progress" | "complete" | "restricted";
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
              "pending" | "in_progress" | "complete" | "restricted";
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
              "pending" | "in_progress" | "complete" | "restricted";
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
              "pending" | "in_progress" | "complete" | "restricted";
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
              "pending" | "in_progress" | "complete" | "restricted";
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
              "pending" | "in_progress" | "complete" | "restricted";
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
              "pending" | "in_progress" | "complete" | "restricted";
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
    costRecovery: {
      mutations: {
        bindInvoiceFunding: FunctionReference<
          "mutation",
          "internal",
          {
            groupKey: string;
            sourceChargeId: string;
            sourceGross: number;
            sourceProcessingFee: number;
          },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            amount: number;
            currency: string;
            groupKey: string;
            invoiceFunding?: {
              sourceChargeId: string;
              sourceGross: number;
              sourceProcessingFee: number;
            };
            invoiceItemId?: string;
            maxCredit: number;
            maxDebit: number;
            pendingOperations: number;
            scopeKey: string;
            sourceGross?: number;
            sourceId: string;
            sourceKind: "settlement" | "invoice";
            sourceProcessingFee?: number;
            status:
              | "open"
              | "sealed"
              | "collecting"
              | "releasing"
              | "collected"
              | "released";
          },
          Name
        >;
        bindInvoiceItem: FunctionReference<
          "mutation",
          "internal",
          { groupKey: string; invoiceItemId: string },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            amount: number;
            currency: string;
            groupKey: string;
            invoiceFunding?: {
              sourceChargeId: string;
              sourceGross: number;
              sourceProcessingFee: number;
            };
            invoiceItemId?: string;
            maxCredit: number;
            maxDebit: number;
            pendingOperations: number;
            scopeKey: string;
            sourceGross?: number;
            sourceId: string;
            sourceKind: "settlement" | "invoice";
            sourceProcessingFee?: number;
            status:
              | "open"
              | "sealed"
              | "collecting"
              | "releasing"
              | "collected"
              | "released";
          },
          Name
        >;
        finish: FunctionReference<
          "mutation",
          "internal",
          { groupKey: string; limit?: number; outcome: "collect" | "release" },
          {
            group: {
              _creationTime: number;
              _id: string;
              accountId: string;
              amount: number;
              currency: string;
              groupKey: string;
              invoiceFunding?: {
                sourceChargeId: string;
                sourceGross: number;
                sourceProcessingFee: number;
              };
              invoiceItemId?: string;
              maxCredit: number;
              maxDebit: number;
              pendingOperations: number;
              scopeKey: string;
              sourceGross?: number;
              sourceId: string;
              sourceKind: "settlement" | "invoice";
              sourceProcessingFee?: number;
              status:
                | "open"
                | "sealed"
                | "collecting"
                | "releasing"
                | "collected"
                | "released";
            };
            isDone: boolean;
          },
          Name
        >;
        importClaim: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            amountDue: number;
            claimKey: string;
            collectedAmount: number;
            currency: string;
            operationKey: string;
            revision: number;
            scopeKey: string;
            sourceChargeId: string;
            sourceGross: number;
            sourceProcessingFee: number;
          },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            amountDue: number;
            claimKey: string;
            collectedAmount: number;
            currency: string;
            openingCollection?: {
              amountDue: number;
              collectedAmount: number;
              operationKey: string;
              revision: number;
            };
            outstanding: number;
            reservedAmount: number;
            revision: number;
            scopeKey: string;
            sign: "positive" | "negative" | "zero";
            sourceChargeId: string;
            sourceGross: number;
            sourceProcessingFee: number;
          },
          Name
        >;
        record: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            amountDue: number;
            claimKey: string;
            currency: string;
            revision: number;
            scopeKey: string;
            sourceChargeId: string;
            sourceGross: number;
            sourceProcessingFee: number;
          },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            amountDue: number;
            claimKey: string;
            collectedAmount: number;
            currency: string;
            openingCollection?: {
              amountDue: number;
              collectedAmount: number;
              operationKey: string;
              revision: number;
            };
            outstanding: number;
            reservedAmount: number;
            revision: number;
            scopeKey: string;
            sign: "positive" | "negative" | "zero";
            sourceChargeId: string;
            sourceGross: number;
            sourceProcessingFee: number;
          },
          Name
        >;
        reserve: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            currency: string;
            groupKey: string;
            limit?: number;
            maxCredit: number;
            maxDebit: number;
            operationKey: string;
            scopeKey: string;
            sourceGross?: number;
            sourceId: string;
            sourceKind: "settlement" | "invoice";
            sourceProcessingFee?: number;
          },
          {
            group: {
              _creationTime: number;
              _id: string;
              accountId: string;
              amount: number;
              currency: string;
              groupKey: string;
              invoiceFunding?: {
                sourceChargeId: string;
                sourceGross: number;
                sourceProcessingFee: number;
              };
              invoiceItemId?: string;
              maxCredit: number;
              maxDebit: number;
              pendingOperations: number;
              scopeKey: string;
              sourceGross?: number;
              sourceId: string;
              sourceKind: "settlement" | "invoice";
              sourceProcessingFee?: number;
              status:
                | "open"
                | "sealed"
                | "collecting"
                | "releasing"
                | "collected"
                | "released";
            };
            reservation: {
              _creationTime: number;
              _id: string;
              allocations: Array<{
                amount: number;
                claimId: string;
                claimKey: string;
              }>;
              amount: number;
              groupKey: string;
              limit: number;
              operationKey: string;
              status: "reserved" | "collected" | "released" | "empty";
            };
          },
          Name
        >;
        rollback: FunctionReference<
          "mutation",
          "internal",
          { groupKey: string; returnedPrincipal: number; revision: number },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            amountDue: number;
            claimKey: string;
            collectedAmount: number;
            currency: string;
            openingCollection?: {
              amountDue: number;
              collectedAmount: number;
              operationKey: string;
              revision: number;
            };
            outstanding: number;
            reservedAmount: number;
            revision: number;
            scopeKey: string;
            sign: "positive" | "negative" | "zero";
            sourceChargeId: string;
            sourceGross: number;
            sourceProcessingFee: number;
          },
          Name
        >;
        seal: FunctionReference<
          "mutation",
          "internal",
          { groupKey: string },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            amount: number;
            currency: string;
            groupKey: string;
            invoiceFunding?: {
              sourceChargeId: string;
              sourceGross: number;
              sourceProcessingFee: number;
            };
            invoiceItemId?: string;
            maxCredit: number;
            maxDebit: number;
            pendingOperations: number;
            scopeKey: string;
            sourceGross?: number;
            sourceId: string;
            sourceKind: "settlement" | "invoice";
            sourceProcessingFee?: number;
            status:
              | "open"
              | "sealed"
              | "collecting"
              | "releasing"
              | "collected"
              | "released";
          },
          Name
        >;
      };
      queries: {
        balance: FunctionReference<
          "query",
          "internal",
          { accountId: string; currency: string; scopeKey: string },
          {
            accountId: string;
            activeGroupKey?: string;
            amountDue: number;
            collectedAmount: number;
            currency: string;
            outstanding: number;
            reservedAmount: number;
            scopeKey: string;
          },
          Name
        >;
        claim: FunctionReference<
          "query",
          "internal",
          { claimKey: string },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            amountDue: number;
            claimKey: string;
            collectedAmount: number;
            currency: string;
            openingCollection?: {
              amountDue: number;
              collectedAmount: number;
              operationKey: string;
              revision: number;
            };
            outstanding: number;
            reservedAmount: number;
            revision: number;
            scopeKey: string;
            sign: "positive" | "negative" | "zero";
            sourceChargeId: string;
            sourceGross: number;
            sourceProcessingFee: number;
          } | null,
          Name
        >;
        group: FunctionReference<
          "query",
          "internal",
          { groupKey: string },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            amount: number;
            currency: string;
            groupKey: string;
            invoiceFunding?: {
              sourceChargeId: string;
              sourceGross: number;
              sourceProcessingFee: number;
            };
            invoiceItemId?: string;
            maxCredit: number;
            maxDebit: number;
            pendingOperations: number;
            scopeKey: string;
            sourceGross?: number;
            sourceId: string;
            sourceKind: "settlement" | "invoice";
            sourceProcessingFee?: number;
            status:
              | "open"
              | "sealed"
              | "collecting"
              | "releasing"
              | "collected"
              | "released";
          } | null,
          Name
        >;
        listClaims: FunctionReference<
          "query",
          "internal",
          {
            accountId: string;
            currency: string;
            paginationOpts: {
              cursor: string | null;
              endCursor?: string | null;
              id?: number;
              maximumBytesRead?: number;
              maximumRowsRead?: number;
              numItems: number;
            };
            scopeKey: string;
          },
          {
            continueCursor: string;
            isDone: boolean;
            page: Array<{
              _creationTime: number;
              _id: string;
              accountId: string;
              amountDue: number;
              claimKey: string;
              collectedAmount: number;
              currency: string;
              openingCollection?: {
                amountDue: number;
                collectedAmount: number;
                operationKey: string;
                revision: number;
              };
              outstanding: number;
              reservedAmount: number;
              revision: number;
              scopeKey: string;
              sign: "positive" | "negative" | "zero";
              sourceChargeId: string;
              sourceGross: number;
              sourceProcessingFee: number;
            }>;
          },
          Name
        >;
        reservation: FunctionReference<
          "query",
          "internal",
          { operationKey: string },
          {
            _creationTime: number;
            _id: string;
            allocations: Array<{
              amount: number;
              claimId: string;
              claimKey: string;
            }>;
            amount: number;
            groupKey: string;
            limit: number;
            operationKey: string;
            status: "reserved" | "collected" | "released" | "empty";
          } | null,
          Name
        >;
      };
    };
    earnings: {
      mutations: {
        backfillCurrencyTotals: FunctionReference<
          "mutation",
          "internal",
          { cursor: string | null; kind: "earnings" | "payouts" },
          { continueCursor: string; isDone: boolean },
          Name
        >;
      };
    };
    payoutPolicy: {
      mutations: {
        beginAttempt: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            adoption?: {
              claims: Array<{ fingerprint: string; operationKey: string }>;
              observations: Array<{
                currency: string;
                ledgerFingerprint: string;
                matureNet: number;
                observedAt: number;
                pendingCredits: number;
                stripeTransferId: string;
                transactionIds: Array<string>;
              }>;
              oldestHeldAt?: number;
            };
            operationKey: string;
            ownerKey: string;
          },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            adoption?: {
              claims: Array<{ fingerprint: string; operationKey: string }>;
              observations: Array<{
                currency: string;
                ledgerFingerprint: string;
                matureNet: number;
                observedAt: number;
                pendingCredits: number;
                stripeTransferId: string;
                transactionIds: Array<string>;
              }>;
              oldestHeldAt?: number;
            };
            attempted?: boolean;
            country: string;
            expectedRevision: number;
            mode: "stripe_managed" | "custom";
            observedAt?: number;
            observedSchedule: {
              interval: "daily" | "weekly" | "monthly" | "manual";
              monthlyDays?: Array<number>;
              weeklyDays?: Array<string>;
            };
            operationKey: string;
            ownerKey: string;
            previousSchedule: {
              interval: "daily" | "weekly" | "monthly" | "manual";
              monthlyDays?: Array<number>;
              weeklyDays?: Array<string>;
            };
            revision: number;
            status: "pending" | "complete" | "canceled";
            targetSchedule: {
              interval: "daily" | "weekly" | "monthly" | "manual";
              monthlyDays?: Array<number>;
              weeklyDays?: Array<string>;
            };
            thresholds: Array<{ amount: number; currency: string }>;
          },
          Name
        >;
        cancelUnattempted: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            observedSchedule: {
              interval: "daily" | "weekly" | "monthly" | "manual";
              monthlyDays?: Array<number>;
              weeklyDays?: Array<string>;
            };
            operationKey: string;
            ownerKey: string;
          },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            adoption?: {
              claims: Array<{ fingerprint: string; operationKey: string }>;
              observations: Array<{
                currency: string;
                ledgerFingerprint: string;
                matureNet: number;
                observedAt: number;
                pendingCredits: number;
                stripeTransferId: string;
                transactionIds: Array<string>;
              }>;
              oldestHeldAt?: number;
            };
            attempted?: boolean;
            country: string;
            expectedRevision: number;
            mode: "stripe_managed" | "custom";
            observedAt?: number;
            observedSchedule: {
              interval: "daily" | "weekly" | "monthly" | "manual";
              monthlyDays?: Array<number>;
              weeklyDays?: Array<string>;
            };
            operationKey: string;
            ownerKey: string;
            previousSchedule: {
              interval: "daily" | "weekly" | "monthly" | "manual";
              monthlyDays?: Array<number>;
              weeklyDays?: Array<string>;
            };
            revision: number;
            status: "pending" | "complete" | "canceled";
            targetSchedule: {
              interval: "daily" | "weekly" | "monthly" | "manual";
              monthlyDays?: Array<number>;
              weeklyDays?: Array<string>;
            };
            thresholds: Array<{ amount: number; currency: string }>;
          },
          Name
        >;
        confirm: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            observedSchedule: {
              interval: "daily" | "weekly" | "monthly" | "manual";
              monthlyDays?: Array<number>;
              weeklyDays?: Array<string>;
            };
            operationKey: string;
            ownerKey: string;
          },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            adoption?: {
              claims: Array<{ fingerprint: string; operationKey: string }>;
              observations: Array<{
                currency: string;
                ledgerFingerprint: string;
                matureNet: number;
                observedAt: number;
                pendingCredits: number;
                stripeTransferId: string;
                transactionIds: Array<string>;
              }>;
              oldestHeldAt?: number;
            };
            attempted?: boolean;
            country: string;
            expectedRevision: number;
            mode: "stripe_managed" | "custom";
            observedAt?: number;
            observedSchedule: {
              interval: "daily" | "weekly" | "monthly" | "manual";
              monthlyDays?: Array<number>;
              weeklyDays?: Array<string>;
            };
            operationKey: string;
            ownerKey: string;
            previousSchedule: {
              interval: "daily" | "weekly" | "monthly" | "manual";
              monthlyDays?: Array<number>;
              weeklyDays?: Array<string>;
            };
            revision: number;
            status: "pending" | "complete" | "canceled";
            targetSchedule: {
              interval: "daily" | "weekly" | "monthly" | "manual";
              monthlyDays?: Array<number>;
              weeklyDays?: Array<string>;
            };
            thresholds: Array<{ amount: number; currency: string }>;
          },
          Name
        >;
        prepare: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            adoption?: {
              claims: Array<{ fingerprint: string; operationKey: string }>;
              observations: Array<{
                currency: string;
                ledgerFingerprint: string;
                matureNet: number;
                observedAt: number;
                pendingCredits: number;
                stripeTransferId: string;
                transactionIds: Array<string>;
              }>;
              oldestHeldAt?: number;
            };
            country: string;
            expectedRevision: number;
            mode: "stripe_managed" | "custom";
            observedAt?: number;
            observedSchedule: {
              interval: "daily" | "weekly" | "monthly" | "manual";
              monthlyDays?: Array<number>;
              weeklyDays?: Array<string>;
            };
            operationKey: string;
            ownerKey: string;
            thresholds: Array<{ amount: number; currency: string }>;
          },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            adoption?: {
              claims: Array<{ fingerprint: string; operationKey: string }>;
              observations: Array<{
                currency: string;
                ledgerFingerprint: string;
                matureNet: number;
                observedAt: number;
                pendingCredits: number;
                stripeTransferId: string;
                transactionIds: Array<string>;
              }>;
              oldestHeldAt?: number;
            };
            attempted?: boolean;
            country: string;
            expectedRevision: number;
            mode: "stripe_managed" | "custom";
            observedAt?: number;
            observedSchedule: {
              interval: "daily" | "weekly" | "monthly" | "manual";
              monthlyDays?: Array<number>;
              weeklyDays?: Array<string>;
            };
            operationKey: string;
            ownerKey: string;
            previousSchedule: {
              interval: "daily" | "weekly" | "monthly" | "manual";
              monthlyDays?: Array<number>;
              weeklyDays?: Array<string>;
            };
            revision: number;
            status: "pending" | "complete" | "canceled";
            targetSchedule: {
              interval: "daily" | "weekly" | "monthly" | "manual";
              monthlyDays?: Array<number>;
              weeklyDays?: Array<string>;
            };
            thresholds: Array<{ amount: number; currency: string }>;
          },
          Name
        >;
      };
      queries: {
        due: FunctionReference<
          "query",
          "internal",
          {
            now: number;
            paginationOpts: {
              cursor: string | null;
              endCursor?: string | null;
              id?: number;
              maximumBytesRead?: number;
              maximumRowsRead?: number;
              numItems: number;
            };
          },
          {
            continueCursor: string;
            isDone: boolean;
            page: Array<{
              _creationTime: number;
              _id: string;
              accountId: string;
              country: string;
              holdDeadline?: number;
              mode: "stripe_managed" | "custom";
              operationKey: string;
              ownerKey: string;
              previousSchedule?: {
                interval: "daily" | "weekly" | "monthly" | "manual";
                monthlyDays?: Array<number>;
                weeklyDays?: Array<string>;
              };
              revision: number;
              status: "changing" | "ready";
              thresholds: Array<{ amount: number; currency: string }>;
            }>;
          },
          Name
        >;
        get: FunctionReference<
          "query",
          "internal",
          { accountId: string; ownerKey: string },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            country: string;
            holdDeadline?: number;
            mode: "stripe_managed" | "custom";
            operationKey: string;
            ownerKey: string;
            previousSchedule?: {
              interval: "daily" | "weekly" | "monthly" | "manual";
              monthlyDays?: Array<number>;
              weeklyDays?: Array<string>;
            };
            revision: number;
            status: "changing" | "ready";
            thresholds: Array<{ amount: number; currency: string }>;
          } | null,
          Name
        >;
        operation: FunctionReference<
          "query",
          "internal",
          { accountId: string; operationKey: string; ownerKey: string },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            adoption?: {
              claims: Array<{ fingerprint: string; operationKey: string }>;
              observations: Array<{
                currency: string;
                ledgerFingerprint: string;
                matureNet: number;
                observedAt: number;
                pendingCredits: number;
                stripeTransferId: string;
                transactionIds: Array<string>;
              }>;
              oldestHeldAt?: number;
            };
            attempted?: boolean;
            country: string;
            expectedRevision: number;
            mode: "stripe_managed" | "custom";
            observedAt?: number;
            observedSchedule: {
              interval: "daily" | "weekly" | "monthly" | "manual";
              monthlyDays?: Array<number>;
              weeklyDays?: Array<string>;
            };
            operationKey: string;
            ownerKey: string;
            previousSchedule: {
              interval: "daily" | "weekly" | "monthly" | "manual";
              monthlyDays?: Array<number>;
              weeklyDays?: Array<string>;
            };
            revision: number;
            status: "pending" | "complete" | "canceled";
            targetSchedule: {
              interval: "daily" | "weekly" | "monthly" | "manual";
              monthlyDays?: Array<number>;
              weeklyDays?: Array<string>;
            };
            thresholds: Array<{ amount: number; currency: string }>;
          } | null,
          Name
        >;
      };
    };
    payoutRelease: {
      mutations: {
        adoptHistoricalBatch: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            expectedClaims: Array<{
              fingerprint: string;
              operationKey: string;
            }>;
            expectedRevision: number;
            observations: Array<{
              currency: string;
              ledgerFingerprint: string;
              matureNet: number;
              observedAt: number;
              pendingCredits: number;
              stripeTransferId: string;
              transactionIds: Array<string>;
            }>;
            ownerKey: string;
            payouts: Array<{
              allocations: Array<{
                amount: number;
                role?: "store" | "affiliate" | "other";
                stripeTransferId: string;
              }>;
              payout: {
                amount: number;
                created: number;
                currency: string;
                debitFee: number;
                debitTransactionId: string;
                destinationId: string;
                returnFee?: number;
                returnTransactionId?: string;
                status: "paid" | "returned";
                stripePayoutId: string;
              };
            }>;
          },
          {
            claims: Array<{
              _creationTime: number;
              _id: string;
              accountId: string;
              allocations: Array<{
                amount: number;
                role?: "store" | "affiliate" | "other";
                stripeTransferId: string;
              }>;
              amount: number;
              attemptedAt?: number;
              currency: string;
              debitFee?: number;
              debitTransactionId?: string;
              destinationId?: string;
              expectedRevision: number;
              feeRevision?: number;
              historical?: boolean;
              observations: Array<{
                currency: string;
                ledgerFingerprint: string;
                matureNet: number;
                observedAt: number;
                pendingCredits: number;
                stripeTransferId: string;
                transactionIds: Array<string>;
              }>;
              operationKey: string;
              ownerKey: string;
              providerFee?: number;
              rejection?: {
                code: "balance_insufficient" | "amount_too_small";
                requestId: string;
              };
              returnTransactionId?: string;
              status:
                | "reserved"
                | "submitted"
                | "paid"
                | "returned"
                | "canceled"
                | "rejected";
              stripePayoutId?: string;
            }>;
          },
          Name
        >;
        beginAttempt: FunctionReference<
          "mutation",
          "internal",
          { accountId: string; operationKey: string; ownerKey: string },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            allocations: Array<{
              amount: number;
              role?: "store" | "affiliate" | "other";
              stripeTransferId: string;
            }>;
            amount: number;
            attemptedAt?: number;
            currency: string;
            debitFee?: number;
            debitTransactionId?: string;
            destinationId?: string;
            expectedRevision: number;
            feeRevision?: number;
            historical?: boolean;
            observations: Array<{
              currency: string;
              ledgerFingerprint: string;
              matureNet: number;
              observedAt: number;
              pendingCredits: number;
              stripeTransferId: string;
              transactionIds: Array<string>;
            }>;
            operationKey: string;
            ownerKey: string;
            providerFee?: number;
            rejection?: {
              code: "balance_insufficient" | "amount_too_small";
              requestId: string;
            };
            returnTransactionId?: string;
            status:
              | "reserved"
              | "submitted"
              | "paid"
              | "returned"
              | "canceled"
              | "rejected";
            stripePayoutId?: string;
          },
          Name
        >;
        cancelUnattempted: FunctionReference<
          "mutation",
          "internal",
          { accountId: string; operationKey: string; ownerKey: string },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            allocations: Array<{
              amount: number;
              role?: "store" | "affiliate" | "other";
              stripeTransferId: string;
            }>;
            amount: number;
            attemptedAt?: number;
            currency: string;
            debitFee?: number;
            debitTransactionId?: string;
            destinationId?: string;
            expectedRevision: number;
            feeRevision?: number;
            historical?: boolean;
            observations: Array<{
              currency: string;
              ledgerFingerprint: string;
              matureNet: number;
              observedAt: number;
              pendingCredits: number;
              stripeTransferId: string;
              transactionIds: Array<string>;
            }>;
            operationKey: string;
            ownerKey: string;
            providerFee?: number;
            rejection?: {
              code: "balance_insufficient" | "amount_too_small";
              requestId: string;
            };
            returnTransactionId?: string;
            status:
              | "reserved"
              | "submitted"
              | "paid"
              | "returned"
              | "canceled"
              | "rejected";
            stripePayoutId?: string;
          },
          Name
        >;
        claim: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            currency: string;
            destinationId?: string;
            expectedRevision: number;
            independentLiabilities: number;
            observations: Array<{
              currency: string;
              ledgerFingerprint: string;
              matureNet: number;
              observedAt: number;
              pendingCredits: number;
              stripeTransferId: string;
              transactionIds: Array<string>;
            }>;
            operationKey: string;
            ownerKey: string;
            providerAvailable: number;
          },
          | {
              _creationTime: number;
              _id: string;
              accountId: string;
              allocations: Array<{
                amount: number;
                role?: "store" | "affiliate" | "other";
                stripeTransferId: string;
              }>;
              amount: number;
              attemptedAt?: number;
              currency: string;
              debitFee?: number;
              debitTransactionId?: string;
              destinationId?: string;
              expectedRevision: number;
              feeRevision?: number;
              historical?: boolean;
              observations: Array<{
                currency: string;
                ledgerFingerprint: string;
                matureNet: number;
                observedAt: number;
                pendingCredits: number;
                stripeTransferId: string;
                transactionIds: Array<string>;
              }>;
              operationKey: string;
              ownerKey: string;
              providerFee?: number;
              rejection?: {
                code: "balance_insufficient" | "amount_too_small";
                requestId: string;
              };
              returnTransactionId?: string;
              status:
                | "reserved"
                | "submitted"
                | "paid"
                | "returned"
                | "canceled"
                | "rejected";
              stripePayoutId?: string;
            }
          | {
              amount: 0;
              currency: string;
              matureUnpaid?: number;
              pendingCredits?: number;
              providerMinimum: null;
              reason:
                "below_threshold" | "insufficient_available" | "pending_claim";
              status: "held";
            },
          Name
        >;
        recordOutcome: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            amount: number;
            currency: string;
            debitFee?: number;
            debitTransactionId?: string;
            operationKey: string;
            ownerKey: string;
            providerStatus:
              "pending" | "in_transit" | "paid" | "failed" | "canceled";
            returnFee?: number;
            returnTransactionId?: string;
            stripePayoutId: string;
          },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            allocations: Array<{
              amount: number;
              role?: "store" | "affiliate" | "other";
              stripeTransferId: string;
            }>;
            amount: number;
            attemptedAt?: number;
            currency: string;
            debitFee?: number;
            debitTransactionId?: string;
            destinationId?: string;
            expectedRevision: number;
            feeRevision?: number;
            historical?: boolean;
            observations: Array<{
              currency: string;
              ledgerFingerprint: string;
              matureNet: number;
              observedAt: number;
              pendingCredits: number;
              stripeTransferId: string;
              transactionIds: Array<string>;
            }>;
            operationKey: string;
            ownerKey: string;
            providerFee?: number;
            rejection?: {
              code: "balance_insufficient" | "amount_too_small";
              requestId: string;
            };
            returnTransactionId?: string;
            status:
              | "reserved"
              | "submitted"
              | "paid"
              | "returned"
              | "canceled"
              | "rejected";
            stripePayoutId?: string;
          },
          Name
        >;
        recordRejection: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            code: "balance_insufficient" | "amount_too_small";
            operationKey: string;
            ownerKey: string;
            requestId: string;
          },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            allocations: Array<{
              amount: number;
              role?: "store" | "affiliate" | "other";
              stripeTransferId: string;
            }>;
            amount: number;
            attemptedAt?: number;
            currency: string;
            debitFee?: number;
            debitTransactionId?: string;
            destinationId?: string;
            expectedRevision: number;
            feeRevision?: number;
            historical?: boolean;
            observations: Array<{
              currency: string;
              ledgerFingerprint: string;
              matureNet: number;
              observedAt: number;
              pendingCredits: number;
              stripeTransferId: string;
              transactionIds: Array<string>;
            }>;
            operationKey: string;
            ownerKey: string;
            providerFee?: number;
            rejection?: {
              code: "balance_insufficient" | "amount_too_small";
              requestId: string;
            };
            returnTransactionId?: string;
            status:
              | "reserved"
              | "submitted"
              | "paid"
              | "returned"
              | "canceled"
              | "rejected";
            stripePayoutId?: string;
          },
          Name
        >;
      };
      queries: {
        fees: FunctionReference<
          "query",
          "internal",
          { accountId: string; currency: string; ownerKey: string },
          { amount: number; revision: number },
          Name
        >;
        get: FunctionReference<
          "query",
          "internal",
          { accountId: string; operationKey: string; ownerKey: string },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            allocations: Array<{
              amount: number;
              role?: "store" | "affiliate" | "other";
              stripeTransferId: string;
            }>;
            amount: number;
            attemptedAt?: number;
            currency: string;
            debitFee?: number;
            debitTransactionId?: string;
            destinationId?: string;
            expectedRevision: number;
            feeRevision?: number;
            historical?: boolean;
            observations: Array<{
              currency: string;
              ledgerFingerprint: string;
              matureNet: number;
              observedAt: number;
              pendingCredits: number;
              stripeTransferId: string;
              transactionIds: Array<string>;
            }>;
            operationKey: string;
            ownerKey: string;
            providerFee?: number;
            rejection?: {
              code: "balance_insufficient" | "amount_too_small";
              requestId: string;
            };
            returnTransactionId?: string;
            status:
              | "reserved"
              | "submitted"
              | "paid"
              | "returned"
              | "canceled"
              | "rejected";
            stripePayoutId?: string;
          } | null,
          Name
        >;
        pending: FunctionReference<
          "query",
          "internal",
          {
            accountId: string;
            ownerKey: string;
            paginationOpts: {
              cursor: string | null;
              endCursor?: string | null;
              id?: number;
              maximumBytesRead?: number;
              maximumRowsRead?: number;
              numItems: number;
            };
          },
          {
            continueCursor: string;
            isDone: boolean;
            page: Array<{
              _creationTime: number;
              _id: string;
              accountId: string;
              allocations: Array<{
                amount: number;
                role?: "store" | "affiliate" | "other";
                stripeTransferId: string;
              }>;
              amount: number;
              attemptedAt?: number;
              currency: string;
              debitFee?: number;
              debitTransactionId?: string;
              destinationId?: string;
              expectedRevision: number;
              feeRevision?: number;
              historical?: boolean;
              observations: Array<{
                currency: string;
                ledgerFingerprint: string;
                matureNet: number;
                observedAt: number;
                pendingCredits: number;
                stripeTransferId: string;
                transactionIds: Array<string>;
              }>;
              operationKey: string;
              ownerKey: string;
              providerFee?: number;
              rejection?: {
                code: "balance_insufficient" | "amount_too_small";
                requestId: string;
              };
              returnTransactionId?: string;
              status:
                | "reserved"
                | "submitted"
                | "paid"
                | "returned"
                | "canceled"
                | "rejected";
              stripePayoutId?: string;
            }>;
          },
          Name
        >;
        preview: FunctionReference<
          "query",
          "internal",
          {
            accountId: string;
            currency: string;
            expectedRevision: number;
            independentLiabilities: number;
            observations: Array<{
              currency: string;
              ledgerFingerprint: string;
              matureNet: number;
              observedAt: number;
              pendingCredits: number;
              stripeTransferId: string;
              transactionIds: Array<string>;
            }>;
            ownerKey: string;
            providerAvailable: number;
          },
          | { amount: 0; reason: string; status: "held" }
          | {
              amount: number;
              confirmedFees: number;
              currency: string;
              independentLiabilities: number;
              matureUnpaid: number;
              observedAt: number;
              pendingCredits: number;
              providerAvailable: number;
              providerMinimum: null;
              reason?: string;
              sources: Array<{
                matureUnpaid: number;
                pendingCredits: number;
                role: "store" | "affiliate" | "other";
              }>;
              status: "held" | "qualified";
              threshold: number;
            },
          Name
        >;
        snapshot: FunctionReference<
          "query",
          "internal",
          { accountId: string; ownerKey: string },
          | { reason: "snapshot_limit"; status: "held" }
          | {
              claims: Array<{
                _creationTime: number;
                _id: string;
                accountId: string;
                allocations: Array<{
                  amount: number;
                  role?: "store" | "affiliate" | "other";
                  stripeTransferId: string;
                }>;
                amount: number;
                attemptedAt?: number;
                currency: string;
                debitFee?: number;
                debitTransactionId?: string;
                destinationId?: string;
                expectedRevision: number;
                feeRevision?: number;
                historical?: boolean;
                observations: Array<{
                  currency: string;
                  ledgerFingerprint: string;
                  matureNet: number;
                  observedAt: number;
                  pendingCredits: number;
                  stripeTransferId: string;
                  transactionIds: Array<string>;
                }>;
                operationKey: string;
                ownerKey: string;
                providerFee?: number;
                rejection?: {
                  code: "balance_insufficient" | "amount_too_small";
                  requestId: string;
                };
                returnTransactionId?: string;
                status:
                  | "reserved"
                  | "submitted"
                  | "paid"
                  | "returned"
                  | "canceled"
                  | "rejected";
                stripePayoutId?: string;
              }>;
              status: "ready";
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
                totalsRecorded?: true;
              }>;
            },
          Name
        >;
      };
    };
    payoutSnapshots: {
      mutations: {
        advance: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            batchSize?: number;
            expectedStep: number;
            operationKey: string;
            ownerKey: string;
          },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            allocationCount: number;
            allocationCursor?: string;
            claimCount: number;
            claimCursor?: string;
            deferredPositiveChanges: boolean;
            expectedRevision: number;
            expiresAt: number;
            feeCount: number;
            feeCursor?: string;
            initialRevision: number;
            initialRiskRevision: number;
            observedRevision: number;
            operationKey: string;
            ownerKey: string;
            phase:
              | "sources"
              | "allocations"
              | "fees"
              | "claims"
              | "repair"
              | "check"
              | "local_ready"
              | "invalidated"
              | "discarding";
            policyMode?: string;
            policyOperationKey?: string;
            providerChanged: boolean;
            readOnly: boolean;
            reason?: string;
            riskRevision: number;
            sourceCount: number;
            sourceCursor?: string;
            sourceFence: number;
            step: number;
          },
          Name
        >;
        begin: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            expectedRevision: number;
            operationKey: string;
            ownerKey: string;
          },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            allocationCount: number;
            allocationCursor?: string;
            claimCount: number;
            claimCursor?: string;
            deferredPositiveChanges: boolean;
            expectedRevision: number;
            expiresAt: number;
            feeCount: number;
            feeCursor?: string;
            initialRevision: number;
            initialRiskRevision: number;
            observedRevision: number;
            operationKey: string;
            ownerKey: string;
            phase:
              | "sources"
              | "allocations"
              | "fees"
              | "claims"
              | "repair"
              | "check"
              | "local_ready"
              | "invalidated"
              | "discarding";
            policyMode?: string;
            policyOperationKey?: string;
            providerChanged: boolean;
            readOnly: boolean;
            reason?: string;
            riskRevision: number;
            sourceCount: number;
            sourceCursor?: string;
            sourceFence: number;
            step: number;
          },
          Name
        >;
        discard: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            batchSize?: number;
            operationKey: string;
            ownerKey: string;
          },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            allocationCount: number;
            allocationCursor?: string;
            claimCount: number;
            claimCursor?: string;
            deferredPositiveChanges: boolean;
            expectedRevision: number;
            expiresAt: number;
            feeCount: number;
            feeCursor?: string;
            initialRevision: number;
            initialRiskRevision: number;
            observedRevision: number;
            operationKey: string;
            ownerKey: string;
            phase:
              | "sources"
              | "allocations"
              | "fees"
              | "claims"
              | "repair"
              | "check"
              | "local_ready"
              | "invalidated"
              | "discarding";
            policyMode?: string;
            policyOperationKey?: string;
            providerChanged: boolean;
            readOnly: boolean;
            reason?: string;
            riskRevision: number;
            sourceCount: number;
            sourceCursor?: string;
            sourceFence: number;
            step: number;
          } | null,
          Name
        >;
      };
    };
    payoutSync: {
      mutations: {
        begin: FunctionReference<
          "mutation",
          "internal",
          { accountId: string; stripePayoutId: string },
          number,
          Name
        >;
        finish: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            generation: number;
            payout: {
              accountId: string;
              amount: number;
              arrivalDate?: string;
              currency: string;
              failureCode?: string;
              failureMessage?: string;
              metadata?: Record<string, string>;
              method?: string;
              status: "pending" | "paid" | "failed" | "canceled" | "in_transit";
              stripePayoutId: string;
            };
            stripePayoutId: string;
          },
          | {
              changed: boolean;
              generation: number;
              payout: {
                _creationTime: number;
                _id: string;
                accountId: string;
                amount: number;
                arrivalDate?: string;
                currency: string;
                failureCode?: string;
                failureMessage?: string;
                metadata?: any;
                method?: string;
                status:
                  "pending" | "paid" | "failed" | "canceled" | "in_transit";
                stripePayoutId: string;
                totalsRecorded?: true;
              };
              status: "accepted";
            }
          | { generation: number; status: "superseded" },
          Name
        >;
        markUnknown: FunctionReference<
          "mutation",
          "internal",
          { accountId: string; generation: number; stripePayoutId: string },
          null,
          Name
        >;
      };
      queries: {
        get: FunctionReference<
          "query",
          "internal",
          { accountId: string; stripePayoutId: string },
          {
            _creationTime: number;
            _id: string;
            acceptedAt?: number;
            acceptedFingerprint?: string;
            acceptedGeneration?: number;
            accountId: string;
            generation: number;
            startedAt: number;
            status: "pending" | "accepted" | "unknown";
            stripePayoutId: string;
          } | null,
          Name
        >;
      };
    };
    payoutWorker: {
      mutations: {
        begin: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            cadenceMs: number;
            currency: string;
            ownerKey: string;
          },
          | { nextAttemptAt?: number; reason: string; status: "held" }
          | {
              job: {
                _creationTime: number;
                _id: string;
                accountId: string;
                cadenceMs: number;
                completedGeneration?: number;
                completedOperationKey?: string;
                currency: string;
                generation: number;
                hasOperation: boolean;
                lastAttemptAt?: number;
                lastReason?: string;
                leaseUntil?: number;
                nextAttemptAt: number;
                operationKey?: string;
                ownerKey: string;
                sequence: number;
              };
              reconcileOnly: boolean;
              status: "run";
            },
          Name
        >;
        finish: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            currency: string;
            generation: number;
            operationKey: string;
            ownerKey: string;
            reason: string;
          },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            cadenceMs: number;
            completedGeneration?: number;
            completedOperationKey?: string;
            currency: string;
            generation: number;
            hasOperation: boolean;
            lastAttemptAt?: number;
            lastReason?: string;
            leaseUntil?: number;
            nextAttemptAt: number;
            operationKey?: string;
            ownerKey: string;
            sequence: number;
          },
          Name
        >;
      };
      queries: {
        changing: FunctionReference<
          "query",
          "internal",
          {
            paginationOpts: {
              cursor: string | null;
              endCursor?: string | null;
              id?: number;
              maximumBytesRead?: number;
              maximumRowsRead?: number;
              numItems: number;
            };
          },
          {
            continueCursor: string;
            isDone: boolean;
            page: Array<{
              _creationTime: number;
              _id: string;
              accountId: string;
              country: string;
              holdDeadline?: number;
              mode: "stripe_managed" | "custom";
              operationKey: string;
              ownerKey: string;
              previousSchedule?: {
                interval: "daily" | "weekly" | "monthly" | "manual";
                monthlyDays?: Array<number>;
                weeklyDays?: Array<string>;
              };
              revision: number;
              status: "changing" | "ready";
              thresholds: Array<{ amount: number; currency: string }>;
            }>;
          },
          Name
        >;
        get: FunctionReference<
          "query",
          "internal",
          { accountId: string; currency: string; ownerKey: string },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            cadenceMs: number;
            completedGeneration?: number;
            completedOperationKey?: string;
            currency: string;
            generation: number;
            hasOperation: boolean;
            lastAttemptAt?: number;
            lastReason?: string;
            leaseUntil?: number;
            nextAttemptAt: number;
            operationKey?: string;
            ownerKey: string;
            sequence: number;
          } | null,
          Name
        >;
        policies: FunctionReference<
          "query",
          "internal",
          {
            paginationOpts: {
              cursor: string | null;
              endCursor?: string | null;
              id?: number;
              maximumBytesRead?: number;
              maximumRowsRead?: number;
              numItems: number;
            };
          },
          {
            continueCursor: string;
            isDone: boolean;
            page: Array<{
              _creationTime: number;
              _id: string;
              accountId: string;
              country: string;
              holdDeadline?: number;
              mode: "stripe_managed" | "custom";
              operationKey: string;
              ownerKey: string;
              previousSchedule?: {
                interval: "daily" | "weekly" | "monthly" | "manual";
                monthlyDays?: Array<number>;
                weeklyDays?: Array<string>;
              };
              revision: number;
              status: "changing" | "ready";
              thresholds: Array<{ amount: number; currency: string }>;
            }>;
          },
          Name
        >;
        recovering: FunctionReference<
          "query",
          "internal",
          {
            paginationOpts: {
              cursor: string | null;
              endCursor?: string | null;
              id?: number;
              maximumBytesRead?: number;
              maximumRowsRead?: number;
              numItems: number;
            };
          },
          {
            continueCursor: string;
            isDone: boolean;
            page: Array<{
              _creationTime: number;
              _id: string;
              accountId: string;
              cadenceMs: number;
              completedGeneration?: number;
              completedOperationKey?: string;
              currency: string;
              generation: number;
              hasOperation: boolean;
              lastAttemptAt?: number;
              lastReason?: string;
              leaseUntil?: number;
              nextAttemptAt: number;
              operationKey?: string;
              ownerKey: string;
              sequence: number;
            }>;
          },
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
        paginatePrices: FunctionReference<
          "query",
          "internal",
          {
            active?: boolean;
            paginationOpts: {
              cursor: string | null;
              endCursor?: string | null;
              id?: number;
              maximumBytesRead?: number;
              maximumRowsRead?: number;
              numItems: number;
            };
            productId?: string;
          },
          {
            continueCursor: string;
            isDone: boolean;
            page: Array<{
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
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
          },
          Name
        >;
        paginateProducts: FunctionReference<
          "query",
          "internal",
          {
            accountId?: string;
            active?: boolean;
            paginationOpts: {
              cursor: string | null;
              endCursor?: string | null;
              id?: number;
              maximumBytesRead?: number;
              maximumRowsRead?: number;
              numItems: number;
            };
          },
          {
            continueCursor: string;
            isDone: boolean;
            page: Array<{
              _creationTime: number;
              _id: string;
              accountId?: string;
              active: boolean;
              description?: string;
              metadata?: any;
              name: string;
              stripeProductId: string;
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
          },
          Name
        >;
      };
    };
    refundHistory: {
      queries: {
        paginateRefunds: FunctionReference<
          "query",
          "internal",
          {
            accountId?: string;
            paginationOpts: {
              cursor: string | null;
              endCursor?: string | null;
              id?: number;
              maximumBytesRead?: number;
              maximumRowsRead?: number;
              numItems: number;
            };
            status?:
              | "pending"
              | "requires_action"
              | "succeeded"
              | "failed"
              | "canceled";
            stripePaymentIntentId?: string;
          },
          {
            continueCursor: string;
            isDone: boolean;
            page: Array<{
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
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
          },
          Name
        >;
      };
    };
    settlement: {
      mutations: {
        claimCommissionInvoice: FunctionReference<
          "mutation",
          "internal",
          {
            affiliateAccountId?: string;
            firstPaidInvoiceId: string;
            invoiceId: string;
            subscriptionId: string;
            term: "forever" | "one_time";
          },
          {
            claimKey: string;
            eligible: boolean;
            firstPaidInvoiceId: string;
            replay: boolean;
            term: "forever" | "one_time";
          },
          Name
        >;
        migrateAffiliateObligations: FunctionReference<
          "mutation",
          "internal",
          {
            paginationOpts: {
              cursor: string | null;
              endCursor?: string | null;
              id?: number;
              maximumBytesRead?: number;
              maximumRowsRead?: number;
              numItems: number;
            };
          },
          {
            continueCursor: string;
            isDone: boolean;
            migrated: number;
            skipped: number;
          },
          Name
        >;
        reserveSettlementAllocation: FunctionReference<
          "mutation",
          "internal",
          {
            adjustmentAmount?: number;
            currency: string;
            gross: number;
            paymentId?: string;
            paymentIntentId?: string;
            platformNet: number;
            processingFee: number;
            sourceChargeId: string;
            sourceInvoiceId?: string;
            transfers: Array<{
              amount: number;
              destinationAccountId: string;
              role: "store" | "affiliate" | "other";
            }>;
          },
          {
            _creationTime: number;
            _id: string;
            adjustmentAmount?: number;
            currency: string;
            gross: number;
            paymentId?: string;
            paymentIntentId?: string;
            platformNet: number;
            processingFee: number;
            sourceChargeId: string;
            sourceInvoiceId?: string;
            transfers: Array<{
              amount: number;
              destinationAccountId: string;
              role: "store" | "affiliate" | "other";
            }>;
          },
          Name
        >;
      };
      queries: {
        getCommissionTerm: FunctionReference<
          "query",
          "internal",
          { subscriptionId: string },
          {
            affiliateAccountId?: string;
            firstPaidInvoiceId: string;
            subscriptionId: string;
            term: "forever" | "one_time";
          } | null,
          Name
        >;
        getSettlementAllocation: FunctionReference<
          "query",
          "internal",
          { sourceChargeId: string },
          {
            _creationTime: number;
            _id: string;
            adjustmentAmount?: number;
            currency: string;
            gross: number;
            paymentId?: string;
            paymentIntentId?: string;
            platformNet: number;
            processingFee: number;
            sourceChargeId: string;
            sourceInvoiceId?: string;
            transfers: Array<{
              amount: number;
              destinationAccountId: string;
              role: "store" | "affiliate" | "other";
            }>;
          } | null,
          Name
        >;
        listAffiliateObligations: FunctionReference<
          "query",
          "internal",
          {
            affiliateAccountId: string;
            currency: string;
            paginationOpts: {
              cursor: string | null;
              endCursor?: string | null;
              id?: number;
              maximumBytesRead?: number;
              maximumRowsRead?: number;
              numItems: number;
            };
          },
          {
            continueCursor: string;
            isDone: boolean;
            page: Array<{
              _creationTime: number;
              _id: string;
              accounted?: boolean;
              activeOperationId?: string;
              affiliateAccountId: string;
              chargeAmount: number;
              creditAmount?: number;
              currency: string;
              debtAmount?: number;
              debtStatus?: "open" | "settled";
              disputeId?: string;
              disputeState?: "open" | "lost" | "won";
              disputedPrincipal: number;
              earningId?: string;
              finalizedAmount: number;
              lastError?: string;
              lastRefundId?: string;
              lastState?: string;
              legacyReceiptIds?: Array<string>;
              legacyRestorationIds?: Array<string>;
              lostPrincipal: number;
              needsReconciliation: boolean;
              offsetAmount?: number;
              operationSequence?: number;
              operatorNote?: string;
              originalCommission: number;
              paymentId?: string;
              paymentIntentId?: string;
              provisionalAmount: number;
              recoveredAmount: number;
              refundedPrincipal: number;
              releasedCommission?: number;
              reservedRecovery?: number;
              reservedRestoration?: number;
              restoredAmount?: number;
              sourceChargeId: string;
              sourceInvoiceId?: string;
              storeAccountId?: string;
              stripeTransferId?: string;
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
          },
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
