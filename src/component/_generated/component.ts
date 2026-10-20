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
    accountClosure: {
      mutations: {
        complete: FunctionReference<
          "mutation",
          "internal",
          { stripeAccountId: string },
          null,
          Name
        >;
        prepare: FunctionReference<
          "mutation",
          "internal",
          { stripeAccountId: string },
          {
            closure: {
              _creationTime: number;
              _id: string;
              appliedConfigurations?: Array<
                "customer" | "merchant" | "recipient"
              >;
              closedAt?: number;
              orgId?: string;
              state: "pending" | "closed";
              stripeAccountId: string;
              userId?: string;
            };
            isRetry: boolean;
          },
          Name
        >;
      };
      queries: {
        getClosedAccountByStripeId: FunctionReference<
          "query",
          "internal",
          { stripeAccountId: string },
          {
            _creationTime: number;
            _id: string;
            appliedConfigurations?: Array<
              "customer" | "merchant" | "recipient"
            >;
            closedAt?: number;
            orgId?: string;
            state: "pending" | "closed";
            stripeAccountId: string;
            userId?: string;
          } | null,
          Name
        >;
        listClosedAccountsByUserId: FunctionReference<
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
            userId: string;
          },
          {
            continueCursor: string;
            isDone: boolean;
            page: Array<{
              _creationTime: number;
              _id: string;
              appliedConfigurations?: Array<
                "customer" | "merchant" | "recipient"
              >;
              closedAt?: number;
              orgId?: string;
              state: "pending" | "closed";
              stripeAccountId: string;
              userId?: string;
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
          },
          Name
        >;
      };
    };
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
    balanceFunding: {
      mutations: {
        begin: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            consent?: true;
            enabled: boolean;
            preparationId: string;
            requestKey: string;
            scopeKey: string;
          },
          | {
              operation: {
                accountId: string;
                operationId: string;
                scopeKey: string;
                version: number;
              };
              status: "accepted";
            }
          | { enabled: boolean; status: "unchanged" }
          | {
              reason: "scope_busy" | "identity_changed" | "revision_changed";
              retryable: false;
              status: "conflict";
            }
          | { reason: "policy_invalid"; retryable: false; status: "rejected" }
          | {
              reason: "provider_pending";
              retryable: true;
              status: "not_ready";
            },
          Name
        >;
        cancelWorkflow: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            definitionVersion: string;
            operationId: string;
            providerApiVersion: string;
            scopeKey: string;
            stripeSubscriptionId: string;
            version: number;
          },
          {
            accountId: string;
            cancelRequested: boolean;
            failureCode?:
              "invalid_scope" | "unsupported_source" | "policy_invalid";
            operationId: string;
            scopeKey: string;
            state:
              | "pending"
              | "running"
              | "unknown"
              | "succeeded"
              | "canceled"
              | "failed";
            version: number;
          },
          Name
        >;
        claimProviderPhase: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            definitionVersion: string;
            operationId: string;
            phase: "create" | "attach" | "apply";
            providerApiVersion: string;
            providerKey: string;
            scopeKey: string;
            stripeSubscriptionId: string;
            version: number;
          },
          | {
              mode: "execute" | "reconcile";
              paymentMethodId?: string;
              status: "claimed";
            }
          | {
              status: "ready";
              value: {
                customerAccount: string;
                enabled?: boolean;
                paymentMethodId: string | null;
                paymentMethodTypes?: Array<string> | null;
                phase: "create" | "attach" | "apply";
                providerApiVersion: string;
                stripeSubscriptionId: string;
              };
            }
          | {
              reason: "provider_outcome_unknown" | "history_incomplete";
              retryable: false;
              status: "unknown";
            }
          | {
              reason: "scope_busy" | "identity_changed" | "revision_changed";
              retryable: false;
              status: "conflict";
            }
          | {
              reason: "invalid_scope" | "unsupported_source" | "policy_invalid";
              retryable: false;
              status: "rejected";
            }
          | {
              reason: "provider_pending";
              retryable: true;
              status: "not_ready";
            },
          Name
        >;
        failBeforeStart: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            failureCode:
              "invalid_scope" | "unsupported_source" | "policy_invalid";
            operationId: string;
            scopeKey: string;
            version: number;
          },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            cancelRequested: boolean;
            enabled: boolean;
            execution?: {
              apply?: {
                receipt?: {
                  customerAccount: string;
                  enabled?: boolean;
                  paymentMethodId: string | null;
                  paymentMethodTypes?: Array<string> | null;
                  phase: "create" | "attach" | "apply";
                  providerApiVersion: string;
                  stripeSubscriptionId: string;
                };
                state: "running" | "unknown" | "succeeded";
              };
              attach?: {
                receipt?: {
                  customerAccount: string;
                  enabled?: boolean;
                  paymentMethodId: string | null;
                  paymentMethodTypes?: Array<string> | null;
                  phase: "create" | "attach" | "apply";
                  providerApiVersion: string;
                  stripeSubscriptionId: string;
                };
                state: "running" | "unknown" | "succeeded";
              };
              create?: {
                receipt?: {
                  customerAccount: string;
                  enabled?: boolean;
                  paymentMethodId: string | null;
                  paymentMethodTypes?: Array<string> | null;
                  phase: "create" | "attach" | "apply";
                  providerApiVersion: string;
                  stripeSubscriptionId: string;
                };
                state: "running" | "unknown" | "succeeded";
              };
              definitionVersion: string;
              providerAction: string;
              providerApiVersion: string;
              workflowId?: string;
            };
            failureCode?:
              "invalid_scope" | "unsupported_source" | "policy_invalid";
            kind: "prepare" | "apply";
            preparationId: string;
            providerKey: string;
            providerKeys: {
              attach?: string;
              create?: string;
              disable: string;
              enable: string;
            };
            receipt?: {
              customerAccount: string;
              paymentMethodId: string | null;
              paymentMethodTypes: Array<string> | null;
              providerApiVersion: string;
              stripeSubscriptionId: string;
            };
            scopeKey: string;
            state:
              | "pending"
              | "running"
              | "unknown"
              | "succeeded"
              | "canceled"
              | "failed";
            version: number;
          },
          Name
        >;
        finish: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            enabled: boolean;
            operationId: string;
            receipt: {
              customerAccount: string;
              paymentMethodId: string | null;
              paymentMethodTypes: Array<string> | null;
              providerApiVersion: string;
              stripeSubscriptionId: string;
            };
            scopeKey: string;
            version: number;
          },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            cancelRequested: boolean;
            enabled: boolean;
            execution?: {
              apply?: {
                receipt?: {
                  customerAccount: string;
                  enabled?: boolean;
                  paymentMethodId: string | null;
                  paymentMethodTypes?: Array<string> | null;
                  phase: "create" | "attach" | "apply";
                  providerApiVersion: string;
                  stripeSubscriptionId: string;
                };
                state: "running" | "unknown" | "succeeded";
              };
              attach?: {
                receipt?: {
                  customerAccount: string;
                  enabled?: boolean;
                  paymentMethodId: string | null;
                  paymentMethodTypes?: Array<string> | null;
                  phase: "create" | "attach" | "apply";
                  providerApiVersion: string;
                  stripeSubscriptionId: string;
                };
                state: "running" | "unknown" | "succeeded";
              };
              create?: {
                receipt?: {
                  customerAccount: string;
                  enabled?: boolean;
                  paymentMethodId: string | null;
                  paymentMethodTypes?: Array<string> | null;
                  phase: "create" | "attach" | "apply";
                  providerApiVersion: string;
                  stripeSubscriptionId: string;
                };
                state: "running" | "unknown" | "succeeded";
              };
              definitionVersion: string;
              providerAction: string;
              providerApiVersion: string;
              workflowId?: string;
            };
            failureCode?:
              "invalid_scope" | "unsupported_source" | "policy_invalid";
            kind: "prepare" | "apply";
            preparationId: string;
            providerKey: string;
            providerKeys: {
              attach?: string;
              create?: string;
              disable: string;
              enable: string;
            };
            receipt?: {
              customerAccount: string;
              paymentMethodId: string | null;
              paymentMethodTypes: Array<string> | null;
              providerApiVersion: string;
              stripeSubscriptionId: string;
            };
            scopeKey: string;
            state:
              | "pending"
              | "running"
              | "unknown"
              | "succeeded"
              | "canceled"
              | "failed";
            version: number;
          },
          Name
        >;
        finishPreparation: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            operationId: string;
            preparation: {
              customerAccount: string;
              paymentMethodId: string;
              previousPaymentMethodId: string | null;
              previousPaymentMethodTypes: Array<string> | null;
              stripeSubscriptionId: string;
            };
            providerApiVersion: string;
            scopeKey: string;
            version: number;
          },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            cancelRequested: boolean;
            enabled: boolean;
            execution?: {
              apply?: {
                receipt?: {
                  customerAccount: string;
                  enabled?: boolean;
                  paymentMethodId: string | null;
                  paymentMethodTypes?: Array<string> | null;
                  phase: "create" | "attach" | "apply";
                  providerApiVersion: string;
                  stripeSubscriptionId: string;
                };
                state: "running" | "unknown" | "succeeded";
              };
              attach?: {
                receipt?: {
                  customerAccount: string;
                  enabled?: boolean;
                  paymentMethodId: string | null;
                  paymentMethodTypes?: Array<string> | null;
                  phase: "create" | "attach" | "apply";
                  providerApiVersion: string;
                  stripeSubscriptionId: string;
                };
                state: "running" | "unknown" | "succeeded";
              };
              create?: {
                receipt?: {
                  customerAccount: string;
                  enabled?: boolean;
                  paymentMethodId: string | null;
                  paymentMethodTypes?: Array<string> | null;
                  phase: "create" | "attach" | "apply";
                  providerApiVersion: string;
                  stripeSubscriptionId: string;
                };
                state: "running" | "unknown" | "succeeded";
              };
              definitionVersion: string;
              providerAction: string;
              providerApiVersion: string;
              workflowId?: string;
            };
            failureCode?:
              "invalid_scope" | "unsupported_source" | "policy_invalid";
            kind: "prepare" | "apply";
            preparationId: string;
            providerKey: string;
            providerKeys: {
              attach?: string;
              create?: string;
              disable: string;
              enable: string;
            };
            receipt?: {
              customerAccount: string;
              paymentMethodId: string | null;
              paymentMethodTypes: Array<string> | null;
              providerApiVersion: string;
              stripeSubscriptionId: string;
            };
            scopeKey: string;
            state:
              | "pending"
              | "running"
              | "unknown"
              | "succeeded"
              | "canceled"
              | "failed";
            version: number;
          },
          Name
        >;
        importPreparation: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            consentAt: number;
            consentReference: string;
            enabled: boolean;
            operationVersion: number;
            pending?: {
              enabled: boolean;
              kind?: "prepare" | "apply";
              providerKey: string;
              requestKey: string;
            };
            preparation: {
              customerAccount: string;
              paymentMethodId?: string;
              previousPaymentMethodId: string | null;
              previousPaymentMethodTypes: Array<string> | null;
              stripeSubscriptionId: string;
            };
            providerApiVersion: string;
            scopeKey: string;
            sourceKey: string;
          },
          {
            operation?: {
              accountId: string;
              operationId: string;
              scopeKey: string;
              version: number;
            };
            preparationId: string;
          },
          Name
        >;
        markUnknown: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            operationId: string;
            scopeKey: string;
            version: number;
          },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            cancelRequested: boolean;
            enabled: boolean;
            execution?: {
              apply?: {
                receipt?: {
                  customerAccount: string;
                  enabled?: boolean;
                  paymentMethodId: string | null;
                  paymentMethodTypes?: Array<string> | null;
                  phase: "create" | "attach" | "apply";
                  providerApiVersion: string;
                  stripeSubscriptionId: string;
                };
                state: "running" | "unknown" | "succeeded";
              };
              attach?: {
                receipt?: {
                  customerAccount: string;
                  enabled?: boolean;
                  paymentMethodId: string | null;
                  paymentMethodTypes?: Array<string> | null;
                  phase: "create" | "attach" | "apply";
                  providerApiVersion: string;
                  stripeSubscriptionId: string;
                };
                state: "running" | "unknown" | "succeeded";
              };
              create?: {
                receipt?: {
                  customerAccount: string;
                  enabled?: boolean;
                  paymentMethodId: string | null;
                  paymentMethodTypes?: Array<string> | null;
                  phase: "create" | "attach" | "apply";
                  providerApiVersion: string;
                  stripeSubscriptionId: string;
                };
                state: "running" | "unknown" | "succeeded";
              };
              definitionVersion: string;
              providerAction: string;
              providerApiVersion: string;
              workflowId?: string;
            };
            failureCode?:
              "invalid_scope" | "unsupported_source" | "policy_invalid";
            kind: "prepare" | "apply";
            preparationId: string;
            providerKey: string;
            providerKeys: {
              attach?: string;
              create?: string;
              disable: string;
              enable: string;
            };
            receipt?: {
              customerAccount: string;
              paymentMethodId: string | null;
              paymentMethodTypes: Array<string> | null;
              providerApiVersion: string;
              stripeSubscriptionId: string;
            };
            scopeKey: string;
            state:
              | "pending"
              | "running"
              | "unknown"
              | "succeeded"
              | "canceled"
              | "failed";
            version: number;
          },
          Name
        >;
        prepare: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            consent: true;
            consentAt: number;
            consentReference: string;
            preparation: {
              customerAccount: string;
              previousPaymentMethodId: string | null;
              previousPaymentMethodTypes: Array<string> | null;
              stripeSubscriptionId: string;
            };
            providerApiVersion: string;
            requestKey: string;
            scopeKey: string;
          },
          | {
              operation: {
                accountId: string;
                operationId: string;
                scopeKey: string;
                version: number;
              };
              status: "accepted";
            }
          | { enabled: boolean; status: "unchanged" }
          | {
              reason: "scope_busy" | "identity_changed" | "revision_changed";
              retryable: false;
              status: "conflict";
            }
          | { reason: "policy_invalid"; retryable: false; status: "rejected" }
          | {
              reason: "provider_pending";
              retryable: true;
              status: "not_ready";
            },
          Name
        >;
        requestCancel: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            operationId: string;
            scopeKey: string;
            version: number;
          },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            cancelRequested: boolean;
            enabled: boolean;
            execution?: {
              apply?: {
                receipt?: {
                  customerAccount: string;
                  enabled?: boolean;
                  paymentMethodId: string | null;
                  paymentMethodTypes?: Array<string> | null;
                  phase: "create" | "attach" | "apply";
                  providerApiVersion: string;
                  stripeSubscriptionId: string;
                };
                state: "running" | "unknown" | "succeeded";
              };
              attach?: {
                receipt?: {
                  customerAccount: string;
                  enabled?: boolean;
                  paymentMethodId: string | null;
                  paymentMethodTypes?: Array<string> | null;
                  phase: "create" | "attach" | "apply";
                  providerApiVersion: string;
                  stripeSubscriptionId: string;
                };
                state: "running" | "unknown" | "succeeded";
              };
              create?: {
                receipt?: {
                  customerAccount: string;
                  enabled?: boolean;
                  paymentMethodId: string | null;
                  paymentMethodTypes?: Array<string> | null;
                  phase: "create" | "attach" | "apply";
                  providerApiVersion: string;
                  stripeSubscriptionId: string;
                };
                state: "running" | "unknown" | "succeeded";
              };
              definitionVersion: string;
              providerAction: string;
              providerApiVersion: string;
              workflowId?: string;
            };
            failureCode?:
              "invalid_scope" | "unsupported_source" | "policy_invalid";
            kind: "prepare" | "apply";
            preparationId: string;
            providerKey: string;
            providerKeys: {
              attach?: string;
              create?: string;
              disable: string;
              enable: string;
            };
            receipt?: {
              customerAccount: string;
              paymentMethodId: string | null;
              paymentMethodTypes: Array<string> | null;
              providerApiVersion: string;
              stripeSubscriptionId: string;
            };
            scopeKey: string;
            state:
              | "pending"
              | "running"
              | "unknown"
              | "succeeded"
              | "canceled"
              | "failed";
            version: number;
          },
          Name
        >;
        resumeWorkflow: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            definitionVersion: string;
            operationId: string;
            providerApiVersion: string;
            scopeKey: string;
            stripeSubscriptionId: string;
            version: number;
          },
          | {
              operation: {
                accountId: string;
                operationId: string;
                scopeKey: string;
                version: number;
              };
              status: "accepted";
              workflowId?: string;
            }
          | {
              operation: {
                accountId: string;
                operationId: string;
                scopeKey: string;
                version: number;
              };
              status: "canceled";
            }
          | {
              reason: "provider_outcome_unknown" | "history_incomplete";
              retryable: false;
              status: "unknown";
            }
          | {
              reason: "scope_busy" | "identity_changed" | "revision_changed";
              retryable: false;
              status: "conflict";
            }
          | {
              reason: "invalid_scope" | "unsupported_source" | "policy_invalid";
              retryable: false;
              status: "rejected";
            }
          | {
              reason: "provider_pending";
              retryable: true;
              status: "not_ready";
            },
          Name
        >;
        savePreparation: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            consentAt: number;
            consentReference: string;
            preparation: {
              customerAccount: string;
              paymentMethodId: string;
              previousPaymentMethodId: string | null;
              previousPaymentMethodTypes: Array<string> | null;
              stripeSubscriptionId: string;
            };
            providerApiVersion: string;
            scopeKey: string;
          },
          { preparationId: string },
          Name
        >;
        setStartsPaused: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            paused: boolean;
            preparationId: string;
            scopeKey: string;
            stripeSubscriptionId: string;
          },
          null,
          Name
        >;
        start: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            operationId: string;
            scopeKey: string;
            version: number;
          },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            cancelRequested: boolean;
            enabled: boolean;
            execution?: {
              apply?: {
                receipt?: {
                  customerAccount: string;
                  enabled?: boolean;
                  paymentMethodId: string | null;
                  paymentMethodTypes?: Array<string> | null;
                  phase: "create" | "attach" | "apply";
                  providerApiVersion: string;
                  stripeSubscriptionId: string;
                };
                state: "running" | "unknown" | "succeeded";
              };
              attach?: {
                receipt?: {
                  customerAccount: string;
                  enabled?: boolean;
                  paymentMethodId: string | null;
                  paymentMethodTypes?: Array<string> | null;
                  phase: "create" | "attach" | "apply";
                  providerApiVersion: string;
                  stripeSubscriptionId: string;
                };
                state: "running" | "unknown" | "succeeded";
              };
              create?: {
                receipt?: {
                  customerAccount: string;
                  enabled?: boolean;
                  paymentMethodId: string | null;
                  paymentMethodTypes?: Array<string> | null;
                  phase: "create" | "attach" | "apply";
                  providerApiVersion: string;
                  stripeSubscriptionId: string;
                };
                state: "running" | "unknown" | "succeeded";
              };
              definitionVersion: string;
              providerAction: string;
              providerApiVersion: string;
              workflowId?: string;
            };
            failureCode?:
              "invalid_scope" | "unsupported_source" | "policy_invalid";
            kind: "prepare" | "apply";
            preparationId: string;
            providerKey: string;
            providerKeys: {
              attach?: string;
              create?: string;
              disable: string;
              enable: string;
            };
            receipt?: {
              customerAccount: string;
              paymentMethodId: string | null;
              paymentMethodTypes: Array<string> | null;
              providerApiVersion: string;
              stripeSubscriptionId: string;
            };
            scopeKey: string;
            state:
              | "pending"
              | "running"
              | "unknown"
              | "succeeded"
              | "canceled"
              | "failed";
            version: number;
          },
          Name
        >;
        startWorkflow: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            definitionVersion: string;
            operationId: string;
            providerAction: string;
            providerApiVersion: string;
            scopeKey: string;
            stripeSubscriptionId: string;
            version: number;
          },
          | {
              operation: {
                accountId: string;
                operationId: string;
                scopeKey: string;
                version: number;
              };
              status: "accepted";
              workflowId?: string;
            }
          | {
              operation: {
                accountId: string;
                operationId: string;
                scopeKey: string;
                version: number;
              };
              status: "canceled";
            }
          | {
              reason: "provider_outcome_unknown" | "history_incomplete";
              retryable: false;
              status: "unknown";
            }
          | {
              reason: "scope_busy" | "identity_changed" | "revision_changed";
              retryable: false;
              status: "conflict";
            }
          | {
              reason: "invalid_scope" | "unsupported_source" | "policy_invalid";
              retryable: false;
              status: "rejected";
            }
          | {
              reason: "provider_pending";
              retryable: true;
              status: "not_ready";
            },
          Name
        >;
      };
      queries: {
        findPreparationOperation: FunctionReference<
          "query",
          "internal",
          {
            accountId: string;
            consent: boolean;
            providerApiVersion: string;
            requestKey: string;
            scopeKey: string;
            stripeSubscriptionId: string;
          },
          | {
              accountId: string;
              cancelRequested: boolean;
              failureCode?:
                "invalid_scope" | "unsupported_source" | "policy_invalid";
              operationId: string;
              scopeKey: string;
              state:
                | "pending"
                | "running"
                | "unknown"
                | "succeeded"
                | "canceled"
                | "failed";
              version: number;
            }
          | {
              reason: "scope_busy" | "identity_changed" | "revision_changed";
              retryable: false;
              status: "conflict";
            }
          | { reason: "invalid_scope"; retryable: false; status: "rejected" }
          | null,
          Name
        >;
        getOperation: FunctionReference<
          "query",
          "internal",
          {
            accountId: string;
            operationId: string;
            scopeKey: string;
            stripeSubscriptionId: string;
            version: number;
          },
          {
            accountId: string;
            cancelRequested: boolean;
            failureCode?:
              "invalid_scope" | "unsupported_source" | "policy_invalid";
            operationId: string;
            scopeKey: string;
            state:
              | "pending"
              | "running"
              | "unknown"
              | "succeeded"
              | "canceled"
              | "failed";
            version: number;
          } | null,
          Name
        >;
        getPreparation: FunctionReference<
          "query",
          "internal",
          {
            accountId: string;
            operationId: string;
            scopeKey: string;
            stripeSubscriptionId: string;
            version: number;
          },
          | {
              operation: {
                accountId: string;
                operationId: string;
                scopeKey: string;
                version: number;
              };
              preparationId: string;
              status: "prepared";
              stripeSubscriptionId: string;
            }
          | {
              failureCode?:
                "invalid_scope" | "unsupported_source" | "policy_invalid";
              operation: {
                accountId: string;
                operationId: string;
                scopeKey: string;
                version: number;
              };
              status: "pending" | "running" | "unknown" | "canceled" | "failed";
            }
          | {
              reason: "scope_busy" | "identity_changed" | "revision_changed";
              retryable: false;
              status: "conflict";
            }
          | { reason: "invalid_scope"; retryable: false; status: "rejected" }
          | null,
          Name
        >;
        inspectOperation: FunctionReference<
          "query",
          "internal",
          {
            accountId: string;
            operationId: string;
            scopeKey: string;
            stripeSubscriptionId: string;
            version: number;
          },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            cancelRequested: boolean;
            enabled: boolean;
            execution?: {
              apply?: {
                receipt?: {
                  customerAccount: string;
                  enabled?: boolean;
                  paymentMethodId: string | null;
                  paymentMethodTypes?: Array<string> | null;
                  phase: "create" | "attach" | "apply";
                  providerApiVersion: string;
                  stripeSubscriptionId: string;
                };
                state: "running" | "unknown" | "succeeded";
              };
              attach?: {
                receipt?: {
                  customerAccount: string;
                  enabled?: boolean;
                  paymentMethodId: string | null;
                  paymentMethodTypes?: Array<string> | null;
                  phase: "create" | "attach" | "apply";
                  providerApiVersion: string;
                  stripeSubscriptionId: string;
                };
                state: "running" | "unknown" | "succeeded";
              };
              create?: {
                receipt?: {
                  customerAccount: string;
                  enabled?: boolean;
                  paymentMethodId: string | null;
                  paymentMethodTypes?: Array<string> | null;
                  phase: "create" | "attach" | "apply";
                  providerApiVersion: string;
                  stripeSubscriptionId: string;
                };
                state: "running" | "unknown" | "succeeded";
              };
              definitionVersion: string;
              providerAction: string;
              providerApiVersion: string;
              workflowId?: string;
            };
            failureCode?:
              "invalid_scope" | "unsupported_source" | "policy_invalid";
            kind: "prepare" | "apply";
            preparationId: string;
            providerKey: string;
            providerKeys: {
              attach?: string;
              create?: string;
              disable: string;
              enable: string;
            };
            receipt?: {
              customerAccount: string;
              paymentMethodId: string | null;
              paymentMethodTypes: Array<string> | null;
              providerApiVersion: string;
              stripeSubscriptionId: string;
            };
            scopeKey: string;
            state:
              | "pending"
              | "running"
              | "unknown"
              | "succeeded"
              | "canceled"
              | "failed";
            version: number;
          } | null,
          Name
        >;
        readPreparation: FunctionReference<
          "query",
          "internal",
          {
            accountId: string;
            preparationId: string;
            scopeKey: string;
            stripeSubscriptionId: string;
          },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            activeOperationId?: string;
            consentAt: number;
            consentReference: string;
            enabled: boolean;
            operationVersion: number;
            preparation: {
              customerAccount: string;
              paymentMethodId?: string;
              previousPaymentMethodId: string | null;
              previousPaymentMethodTypes: Array<string> | null;
              stripeSubscriptionId: string;
            };
            preparationOperationId?: string;
            providerApiVersion: string;
            scopeKey: string;
            startsPaused: boolean;
            verified: boolean;
          } | null,
          Name
        >;
        readScopePreparation: FunctionReference<
          "query",
          "internal",
          {
            accountId: string;
            providerApiVersion: string;
            scopeKey: string;
            stripeSubscriptionId: string;
          },
          | {
              _creationTime: number;
              _id: string;
              accountId: string;
              activeOperationId?: string;
              consentAt: number;
              consentReference: string;
              enabled: boolean;
              operationVersion: number;
              preparation: {
                customerAccount: string;
                paymentMethodId?: string;
                previousPaymentMethodId: string | null;
                previousPaymentMethodTypes: Array<string> | null;
                stripeSubscriptionId: string;
              };
              preparationOperationId?: string;
              providerApiVersion: string;
              scopeKey: string;
              startsPaused: boolean;
              verified: boolean;
            }
          | {
              reason: "scope_busy" | "identity_changed" | "revision_changed";
              retryable: false;
              status: "conflict";
            }
          | { reason: "invalid_scope"; retryable: false; status: "rejected" }
          | null,
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
          { requireUnique?: boolean; stripeSubscriptionId: string },
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
    billingHistory: {
      queries: {
        paginateCheckoutSessions: FunctionReference<
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
            status?: "open" | "complete" | "expired";
            userId: string;
          },
          {
            continueCursor: string;
            isDone: boolean;
            page: Array<{
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
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
          },
          Name
        >;
        paginateSubscriptions: FunctionReference<
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
          {
            continueCursor: string;
            isDone: boolean;
            page: Array<{
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
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
          },
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
          { requireUnique?: boolean; stripePaymentIntentId: string },
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
            refundCommandConflict?: boolean;
            refundCommandKey?: string;
            refundCommandNormalizationVersion?: 1;
            refundCommandObservedAt?: number;
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
            refundCommandConflict?: boolean;
            refundCommandKey?: string;
            refundCommandNormalizationVersion?: 1;
            refundCommandObservedAt?: number;
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
          { requireUnique?: boolean; stripeAccountId: string },
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
        getPersonalAccountMapping: FunctionReference<
          "query",
          "internal",
          { userId: string },
          | {
              account: {
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
              };
              status: "unique";
            }
          | {
              reason:
                | "missing"
                | "ambiguous"
                | "organization"
                | "invalid_account"
                | "closure_unresolved"
                | "closed";
              status: "unavailable";
            },
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
            preparationSequence?: number;
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
            preparationSequence?: number;
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
              preparationSequence?: number;
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
              preparationSequence?: number;
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
            preparationSequence?: number;
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
      preparation: {
        prepare: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            currency: string;
            groupKey: string;
            limit?: number;
            maxCredit: number;
            maxDebit: number;
            scopeKey: string;
            sourceGross?: number;
            sourceId: string;
            sourceKind: "settlement" | "invoice";
            sourceProcessingFee?: number;
          },
          | {
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
                preparationSequence?: number;
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
              status: "prepared";
            }
          | {
              reason: "scope_busy" | "identity_changed";
              retryable: false;
              status: "conflict";
            }
          | {
              reason: "invalid_scope" | "policy_invalid";
              retryable: false;
              status: "rejected";
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
            preparationSequence?: number;
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
        payoutQuote: FunctionReference<
          "query",
          "internal",
          { accountId: string; currency: string; scopeKey: string },
          { independentLiabilities: number; liabilityRevision: number },
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
    financialObservations: {
      mutations: {
        resume: FunctionReference<
          "mutation",
          "internal",
          { allocationId: string; expectedGeneration: number },
          {
            coverage: "unknown";
            observation: {
              _creationTime: number;
              _id: string;
              allocationId: string;
              continuation?: {
                nextLeg: number;
                state: "indexing" | "validating" | "complete" | "held";
                validatedLegs: number;
              };
              fingerprint: string;
              generation: number;
              indexedLegCount: number;
              isContradictory: boolean;
              isOverflow: boolean;
              legCount: number;
              observedFingerprint: string;
              ownershipFingerprint: string;
              producer: "settlement_allocation";
              producerVersion: 1;
              sourceChargeId: string;
            } | null;
          },
          Name
        >;
        resumeTransferBatch: FunctionReference<
          "mutation",
          "internal",
          { batchId: string; expectedGeneration: number },
          {
            batch: {
              _creationTime: number;
              _id: string;
              continuation?: {
                nextReference: number;
                producerGeneration: number;
                sourceFingerprint: string;
                state: "indexing" | "validating" | "complete" | "held";
                validatedReferences: number;
              };
              fingerprint: string;
              generation: number;
              isContradictory: boolean;
              isOverflow: true;
              observedFingerprint: string;
              operationId: string;
              originalOperationId: string;
              producer: "transfer_frontier_release" | "transfer_frontier_claim";
              producerVersion: 1;
              referenceCount: number;
              sourceChargeId: string;
              state: "pending" | "complete";
              transferIds: Array<string>;
            } | null;
            coverage: "unknown";
            hasDeferredWork: boolean;
            producerGeneration: number | null;
          },
          Name
        >;
      };
      queries: {
        bucket: FunctionReference<
          "query",
          "internal",
          {
            bucketKey: string;
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
            coverage: "unknown";
            generation: number | null;
            isDone: boolean;
            page: Array<{
              _creationTime: number;
              _id: string;
              allocationId: string;
              bucketKey: string;
              legIndex: number;
              orgId?: string;
              ownershipStatus:
                "registered" | "unknown" | "ambiguous" | "contradictory";
              registrationId?: string;
              role: "store" | "affiliate" | "other";
              sourceChargeId: string;
              userId?: string;
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
          },
          Name
        >;
        owner: FunctionReference<
          "query",
          "internal",
          {
            orgId?: string;
            paginationOpts: {
              cursor: string | null;
              endCursor?: string | null;
              id?: number;
              maximumBytesRead?: number;
              maximumRowsRead?: number;
              numItems: number;
            };
            userId: string;
          },
          {
            continueCursor: string;
            coverage: "unknown";
            generation: number | null;
            isDone: boolean;
            page: Array<{
              _creationTime: number;
              _id: string;
              allocationId: string;
              bucketKey: string;
              legIndex: number;
              orgId?: string;
              ownershipStatus:
                "registered" | "unknown" | "ambiguous" | "contradictory";
              registrationId?: string;
              role: "store" | "affiliate" | "other";
              sourceChargeId: string;
              userId?: string;
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
          },
          Name
        >;
        source: FunctionReference<
          "query",
          "internal",
          { allocationId: string },
          {
            coverage: "unknown";
            observation: null | {
              _creationTime: number;
              _id: string;
              allocationId: string;
              continuation?: {
                nextLeg: number;
                state: "indexing" | "validating" | "complete" | "held";
                validatedLegs: number;
              };
              fingerprint: string;
              generation: number;
              indexedLegCount: number;
              isContradictory: boolean;
              isOverflow: boolean;
              legCount: number;
              observedFingerprint: string;
              ownershipFingerprint: string;
              producer: "settlement_allocation";
              producerVersion: 1;
              sourceChargeId: string;
            };
          },
          Name
        >;
        transfer: FunctionReference<
          "query",
          "internal",
          { transferId: string },
          {
            coverage: "unknown";
            hasDeferredWork: boolean;
            observation: {
              _creationTime: number;
              _id: string;
              bucketKey: string;
              fingerprint: string;
              generation: number;
              isContradictory: boolean;
              observedFingerprint: string;
              orgId?: string;
              ownershipFingerprint: string;
              ownershipStatus:
                "registered" | "unknown" | "ambiguous" | "contradictory";
              producer: "transfer_fact";
              producerVersion: 1;
              registrationId?: string;
              role?: "store" | "affiliate" | "other";
              sourceChargeId?: string;
              sourceInvoiceId?: string;
              stripeTransferId: string;
              transferId: string;
              userId?: string;
            } | null;
            producerGeneration: number | null;
          },
          Name
        >;
        transferBatch: FunctionReference<
          "query",
          "internal",
          { batchId: string },
          {
            batch: {
              _creationTime: number;
              _id: string;
              continuation?: {
                nextReference: number;
                producerGeneration: number;
                sourceFingerprint: string;
                state: "indexing" | "validating" | "complete" | "held";
                validatedReferences: number;
              };
              fingerprint: string;
              generation: number;
              isContradictory: boolean;
              isOverflow: true;
              observedFingerprint: string;
              operationId: string;
              originalOperationId: string;
              producer: "transfer_frontier_release" | "transfer_frontier_claim";
              producerVersion: 1;
              referenceCount: number;
              sourceChargeId: string;
              state: "pending" | "complete";
              transferIds: Array<string>;
            } | null;
            coverage: "unknown";
            hasDeferredWork: boolean;
            producerGeneration: number | null;
          },
          Name
        >;
        transferBatches: FunctionReference<
          "query",
          "internal",
          {
            operationId: string;
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
            coverage: "unknown";
            hasDeferredWork: boolean;
            isDone: boolean;
            page: Array<{
              _creationTime: number;
              _id: string;
              continuation?: {
                nextReference: number;
                producerGeneration: number;
                sourceFingerprint: string;
                state: "indexing" | "validating" | "complete" | "held";
                validatedReferences: number;
              };
              fingerprint: string;
              generation: number;
              isContradictory: boolean;
              isOverflow: true;
              observedFingerprint: string;
              operationId: string;
              originalOperationId: string;
              producer: "transfer_frontier_release" | "transfer_frontier_claim";
              producerVersion: 1;
              referenceCount: number;
              sourceChargeId: string;
              state: "pending" | "complete";
              transferIds: Array<string>;
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            producerGeneration: number | null;
            splitCursor?: string | null;
          },
          Name
        >;
        transferBucket: FunctionReference<
          "query",
          "internal",
          {
            bucketKey: string;
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
            coverage: "unknown";
            generation: number | null;
            hasDeferredWork: boolean;
            isDone: boolean;
            page: Array<{
              _creationTime: number;
              _id: string;
              bucketKey: string;
              fingerprint: string;
              generation: number;
              isContradictory: boolean;
              observedFingerprint: string;
              orgId?: string;
              ownershipFingerprint: string;
              ownershipStatus:
                "registered" | "unknown" | "ambiguous" | "contradictory";
              producer: "transfer_fact";
              producerVersion: 1;
              registrationId?: string;
              role?: "store" | "affiliate" | "other";
              sourceChargeId?: string;
              sourceInvoiceId?: string;
              stripeTransferId: string;
              transferId: string;
              userId?: string;
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            producerGeneration: number | null;
            splitCursor?: string | null;
          },
          Name
        >;
        transferOwner: FunctionReference<
          "query",
          "internal",
          {
            orgId?: string;
            paginationOpts: {
              cursor: string | null;
              endCursor?: string | null;
              id?: number;
              maximumBytesRead?: number;
              maximumRowsRead?: number;
              numItems: number;
            };
            userId: string;
          },
          {
            continueCursor: string;
            coverage: "unknown";
            generation: number | null;
            hasDeferredWork: boolean;
            isDone: boolean;
            page: Array<{
              _creationTime: number;
              _id: string;
              bucketKey: string;
              fingerprint: string;
              generation: number;
              isContradictory: boolean;
              observedFingerprint: string;
              orgId?: string;
              ownershipFingerprint: string;
              ownershipStatus:
                "registered" | "unknown" | "ambiguous" | "contradictory";
              producer: "transfer_fact";
              producerVersion: 1;
              registrationId?: string;
              role?: "store" | "affiliate" | "other";
              sourceChargeId?: string;
              sourceInvoiceId?: string;
              stripeTransferId: string;
              transferId: string;
              userId?: string;
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            producerGeneration: number | null;
            splitCursor?: string | null;
          },
          Name
        >;
        transferReferences: FunctionReference<
          "query",
          "internal",
          {
            batchId: string;
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
            coverage: "unknown";
            hasDeferredWork: boolean;
            isDone: boolean;
            page: Array<{
              _creationTime: number;
              _id: string;
              batchId: string;
              observationGeneration: number;
              observationId: string;
              observedFingerprint: string;
              ownershipFingerprint: string;
              position: number;
              sourceFingerprint: string;
              transferId: string;
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            producerGeneration: number | null;
            splitCursor?: string | null;
          },
          Name
        >;
      };
    };
    financialOwnership: {
      mutations: {
        register: FunctionReference<
          "mutation",
          "internal",
          {
            bucketKey: string;
            kind: "stripe_account" | "logical";
            orgId?: string;
            source?: { integration: string; recordId: string };
            userId: string;
          },
          {
            coverage: "unknown";
            registration: {
              _creationTime: number;
              _id: string;
              bucketKey: string;
              generation: number;
              kind: "stripe_account" | "logical";
              orgId?: string;
              source: { integration: string; recordId: string };
              userId: string;
            };
            status: "registered";
          },
          Name
        >;
      };
      queries: {
        discover: FunctionReference<
          "query",
          "internal",
          {
            orgId?: string;
            paginationOpts: {
              cursor: string | null;
              endCursor?: string | null;
              id?: number;
              maximumBytesRead?: number;
              maximumRowsRead?: number;
              numItems: number;
            };
            userId: string;
          },
          {
            continueCursor: string;
            coverage: "unknown";
            generation: number;
            isDone: boolean;
            page: Array<{
              _creationTime: number;
              _id: string;
              bucketKey: string;
              generation: number;
              kind: "stripe_account" | "logical";
              orgId?: string;
              source: { integration: string; recordId: string };
              userId: string;
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
          },
          Name
        >;
        lookup: FunctionReference<
          "query",
          "internal",
          { bucketKey: string },
          | {
              coverage: "unknown";
              registration: {
                _creationTime: number;
                _id: string;
                bucketKey: string;
                generation: number;
                kind: "stripe_account" | "logical";
                orgId?: string;
                source: { integration: string; recordId: string };
                userId: string;
              };
              status: "registered";
            }
          | { coverage: "unknown"; status: "unknown" },
          Name
        >;
      };
    };
    operationEvidence: {
      mutations: {
        capture: FunctionReference<
          "mutation",
          "internal",
          { sourceId: string },
          {
            coverage: "unknown";
            evidenceGeneration: number | null;
            header: {
              _creationTime: number;
              _id: string;
              firstObservedAt: number;
              generation: number;
              isContradictory: boolean;
              latestFingerprint: string;
              latestPayloadId: string;
              operationDigest: string;
              originalFingerprint: string;
              originalIdentityFingerprint: string;
              originalPayloadId: string;
              producer: "trusted_host_maintenance";
              producerVersion: 1;
              sourceChargeDigest: string;
              sourceCreatedAt: number;
              sourceId: string;
            } | null;
            status:
              | "captured"
              | "updated"
              | "unchanged"
              | "unavailable"
              | "source_unavailable";
          },
          Name
        >;
      };
      queries: {
        headers: FunctionReference<
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
            coverage: "unknown";
            evidenceGeneration: number | null;
            isDone: boolean;
            page: Array<{
              _creationTime: number;
              _id: string;
              firstObservedAt: number;
              generation: number;
              isContradictory: boolean;
              latestFingerprint: string;
              latestPayloadId: string;
              operationDigest: string;
              originalFingerprint: string;
              originalIdentityFingerprint: string;
              originalPayloadId: string;
              producer: "trusted_host_maintenance";
              producerVersion: 1;
              sourceChargeDigest: string;
              sourceCreatedAt: number;
              sourceId: string;
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
          },
          Name
        >;
        latest: FunctionReference<
          "query",
          "internal",
          { headerId: string },
          {
            coverage: "unknown";
            evidenceGeneration: number | null;
            header: {
              _creationTime: number;
              _id: string;
              firstObservedAt: number;
              generation: number;
              isContradictory: boolean;
              latestFingerprint: string;
              latestPayloadId: string;
              operationDigest: string;
              originalFingerprint: string;
              originalIdentityFingerprint: string;
              originalPayloadId: string;
              producer: "trusted_host_maintenance";
              producerVersion: 1;
              sourceChargeDigest: string;
              sourceCreatedAt: number;
              sourceId: string;
            } | null;
            payload: {
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
            } | null;
          },
          Name
        >;
        original: FunctionReference<
          "query",
          "internal",
          { headerId: string },
          {
            coverage: "unknown";
            evidenceGeneration: number | null;
            header: {
              _creationTime: number;
              _id: string;
              firstObservedAt: number;
              generation: number;
              isContradictory: boolean;
              latestFingerprint: string;
              latestPayloadId: string;
              operationDigest: string;
              originalFingerprint: string;
              originalIdentityFingerprint: string;
              originalPayloadId: string;
              producer: "trusted_host_maintenance";
              producerVersion: 1;
              sourceChargeDigest: string;
              sourceCreatedAt: number;
              sourceId: string;
            } | null;
            payload: {
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
            } | null;
          },
          Name
        >;
        resolve: FunctionReference<
          "query",
          "internal",
          { selector: "operationId" | "sourceChargeId"; value: string },
          {
            coverage: "unknown";
            evidenceGeneration: number | null;
            header: {
              _creationTime: number;
              _id: string;
              firstObservedAt: number;
              generation: number;
              isContradictory: boolean;
              latestFingerprint: string;
              latestPayloadId: string;
              operationDigest: string;
              originalFingerprint: string;
              originalIdentityFingerprint: string;
              originalPayloadId: string;
              producer: "trusted_host_maintenance";
              producerVersion: 1;
              sourceChargeDigest: string;
              sourceCreatedAt: number;
              sourceId: string;
            } | null;
          },
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
              collectionKey?: string;
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
              snapshotId?: string;
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
              collectionKey?: string;
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
              snapshotId?: string;
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
        beginHoldingExpiry: FunctionReference<
          "mutation",
          "internal",
          { accountId: string; ownerKey: string },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            country: string;
            holdDeadline?: number;
            holdingExpiry?: {
              balances?: Array<{
                available: number;
                currency: string;
                pending: number;
              }>;
              deadline: number;
              observedAt?: number;
              status:
                | "unverified"
                | "balance_remaining"
                | "claims_unresolved"
                | "no_held_balance";
            };
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
              collectionKey?: string;
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
              snapshotId?: string;
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
              collectionKey?: string;
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
              snapshotId?: string;
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
        observeHoldingExpiry: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            balances: Array<{
              available: number;
              currency: string;
              pending: number;
            }>;
            deadline: number;
            expectedRevision: number;
            observedAt: number;
            ownerKey: string;
          },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            country: string;
            holdDeadline?: number;
            holdingExpiry?: {
              balances?: Array<{
                available: number;
                currency: string;
                pending: number;
              }>;
              deadline: number;
              observedAt?: number;
              status:
                | "unverified"
                | "balance_remaining"
                | "claims_unresolved"
                | "no_held_balance";
            };
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
              collectionKey?: string;
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
              snapshotId?: string;
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
              collectionKey?: string;
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
              snapshotId?: string;
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
              holdingExpiry?: {
                balances?: Array<{
                  available: number;
                  currency: string;
                  pending: number;
                }>;
                deadline: number;
                observedAt?: number;
                status:
                  | "unverified"
                  | "balance_remaining"
                  | "claims_unresolved"
                  | "no_held_balance";
              };
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
            holdingExpiry?: {
              balances?: Array<{
                available: number;
                currency: string;
                pending: number;
              }>;
              deadline: number;
              observedAt?: number;
              status:
                | "unverified"
                | "balance_remaining"
                | "claims_unresolved"
                | "no_held_balance";
            };
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
              collectionKey?: string;
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
              snapshotId?: string;
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
            snapshotId?: string;
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
              independentLiabilities?: number;
              liabilityRevision?: number;
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
              snapshotId?: string;
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
            independentLiabilities?: number;
            liabilityRevision?: number;
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
            snapshotId?: string;
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
            independentLiabilities?: number;
            liabilityRevision?: number;
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
            snapshotId?: string;
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
            liabilityRevision?: number;
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
            snapshotId?: string;
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
              independentLiabilities?: number;
              liabilityRevision?: number;
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
              snapshotId?: string;
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
            independentLiabilities?: number;
            liabilityRevision?: number;
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
            snapshotId?: string;
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
        recordOutcomes: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            outcomes: Array<{
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
            }>;
            ownerKey: string;
          },
          Array<{
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
            independentLiabilities?: number;
            liabilityRevision?: number;
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
            snapshotId?: string;
            status:
              | "reserved"
              | "submitted"
              | "paid"
              | "returned"
              | "canceled"
              | "rejected";
            stripePayoutId?: string;
          }>,
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
            independentLiabilities?: number;
            liabilityRevision?: number;
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
            snapshotId?: string;
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
            independentLiabilities?: number;
            liabilityRevision?: number;
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
            snapshotId?: string;
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
              independentLiabilities?: number;
              liabilityRevision?: number;
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
              snapshotId?: string;
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
            liabilityRevision?: number;
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
            snapshotId?: string;
          },
          | { amount: 0; reason: string; status: "held" }
          | {
              accounting?: {
                carriedForwardAmount: number;
                releasedAmount: number;
                reservedAmount: number;
                withheldAmount: number;
              };
              amount: number;
              confirmedFees: number;
              currency: string;
              holdDeadline?: number;
              independentLiabilities: number;
              matureUnpaid: number;
              minimumWaived?: boolean;
              observedAt: number;
              pendingCredits: number;
              providerAvailable: number;
              providerMinimum: null;
              reason?: string;
              sources: Array<{
                matureUnpaid: number;
                pendingCredits: number;
                releasedAmount?: number;
                reservedAmount?: number;
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
                independentLiabilities?: number;
                liabilityRevision?: number;
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
                snapshotId?: string;
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
    payoutRevisionJournal: {
      mutations: {
        activateAccount: FunctionReference<
          "mutation",
          "internal",
          { accountId: string },
          {
            accountId: string;
            reason?:
              | "legacy_ambiguous"
              | "legacy_invalid"
              | "legacy_disagreement"
              | "representation_unavailable";
            status: "activated" | "unchanged" | "held";
          },
          Name
        >;
      };
    };
    payoutRevisionMigration: {
      mutations: {
        begin: FunctionReference<
          "mutation",
          "internal",
          { operationKey: string },
          {
            _creationTime: number;
            _id: string;
            activated: number;
            cursor: string | null;
            held: number;
            operationKey: string;
            phase: number;
            scanned: number;
            status: "running" | "finished";
            step: number;
            unchanged: number;
            visited: number;
          },
          Name
        >;
        resume: FunctionReference<
          "mutation",
          "internal",
          { expectedStep: number; jobId: string },
          {
            _creationTime: number;
            _id: string;
            activated: number;
            cursor: string | null;
            held: number;
            operationKey: string;
            phase: number;
            scanned: number;
            status: "running" | "finished";
            step: number;
            unchanged: number;
            visited: number;
          },
          Name
        >;
      };
      queries: {
        get: FunctionReference<
          "query",
          "internal",
          { jobId: string },
          {
            _creationTime: number;
            _id: string;
            activated: number;
            cursor: string | null;
            held: number;
            operationKey: string;
            phase: number;
            scanned: number;
            status: "running" | "finished";
            step: number;
            unchanged: number;
            visited: number;
          } | null,
          Name
        >;
        results: FunctionReference<
          "query",
          "internal",
          {
            jobId: string;
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
              accountDigest: string;
              accountId?: string;
              jobId: string;
              reason?:
                | "legacy_ambiguous"
                | "legacy_invalid"
                | "legacy_disagreement"
                | "representation_unavailable";
              sourceId: string;
              sourceTable: string;
              status: "activated" | "unchanged" | "held";
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
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
            boundOperationKey?: string;
            boundRiskRevision?: number;
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
            boundOperationKey?: string;
            boundRiskRevision?: number;
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
            boundOperationKey?: string;
            boundRiskRevision?: number;
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
      queries: {
        claims: FunctionReference<
          "query",
          "internal",
          {
            accountId: string;
            operationKey: string;
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
              independentLiabilities?: number;
              liabilityRevision?: number;
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
              snapshotId?: string;
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
        get: FunctionReference<
          "query",
          "internal",
          { accountId: string; operationKey: string; ownerKey: string },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            allocationCount: number;
            allocationCursor?: string;
            boundOperationKey?: string;
            boundRiskRevision?: number;
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
        sources: FunctionReference<
          "query",
          "internal",
          {
            accountId: string;
            operationKey: string;
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
                lastResultAt?: number;
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
            lastResultAt?: number;
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
              holdingExpiry?: {
                balances?: Array<{
                  available: number;
                  currency: string;
                  pending: number;
                }>;
                deadline: number;
                observedAt?: number;
                status:
                  | "unverified"
                  | "balance_remaining"
                  | "claims_unresolved"
                  | "no_held_balance";
              };
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
            lastResultAt?: number;
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
              holdingExpiry?: {
                balances?: Array<{
                  available: number;
                  currency: string;
                  pending: number;
                }>;
                deadline: number;
                observedAt?: number;
                status:
                  | "unverified"
                  | "balance_remaining"
                  | "claims_unresolved"
                  | "no_held_balance";
              };
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
              lastResultAt?: number;
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
    processingCostReconciliation: {
      mutations: {
        resume: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            currency: string;
            operationId: string;
            scopeKey: string;
            version: number;
          },
          | {
              accountId: string;
              currency: string;
              operationId: string;
              scopeKey: string;
              status: "queued" | "running";
              version: number;
            }
          | {
              accountId: string;
              currency: string;
              operationId: string;
              result: {
                claim: {
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
                };
                deficit: {
                  amountDue: number;
                  currency: string;
                  disputeLiability: number;
                  processingLiability: number;
                  retainedFee: number;
                };
                observation: {
                  currency: string;
                  disputeFees: number;
                  gross: number;
                  originalProcessingFee: number;
                  paymentIntentId: string;
                  principalReturned: number;
                  processingFee: number;
                  provenance: {
                    customerAccountId: string;
                    invoiceId: string;
                    invoicePaymentId: string;
                    recoveryInvoiceItemId?: string;
                    stripePriceId?: string;
                    stripeProductId?: string;
                    subscriptionId?: string;
                  };
                  sourceChargeId: string;
                };
                rollbackClaim?: {
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
                };
              };
              scopeKey: string;
              status: "completed";
              version: number;
            }
          | {
              accountId: string;
              currency: string;
              operationId: string;
              reason: string;
              retryable: boolean;
              scopeKey: string;
              status: "not_ready" | "conflict" | "rejected" | "unknown";
              version: number;
            },
          Name
        >;
        start: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            claimKey: string;
            currency: string;
            definitionVersion: number;
            expectedRevision: number;
            importHook?: string;
            maxAttempts: number;
            policy: {
              liability: {
                disputeCosts: "all" | "none";
                processingCosts: "uncovered" | "all" | "none";
              };
              rounding: "nearest" | "floor" | "ceil";
              sellingFee: number;
            };
            projection?: string;
            provider: string;
            providerApiVersion: string;
            requestKey: string;
            retryDelayMs: number;
            rollback?: { expectedRevision: number; groupKey: string };
            scopeKey: string;
            source:
              | {
                  customerAccountId: string;
                  gross: number;
                  invoiceId?: string;
                  kind: "sale";
                  paymentIntentId: string;
                  stripeAccountId?: string;
                  stripePriceId?: string;
                  stripeProductId?: string;
                  subscriptionId?: string;
                }
              | {
                  gross: number;
                  groupKey: string;
                  kind: "invoice_recovery";
                  paymentIntentId: string;
                };
          },
          | {
              accountId: string;
              currency: string;
              operationId: string;
              scopeKey: string;
              status: "queued" | "running";
              version: number;
            }
          | {
              accountId: string;
              currency: string;
              operationId: string;
              result: {
                claim: {
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
                };
                deficit: {
                  amountDue: number;
                  currency: string;
                  disputeLiability: number;
                  processingLiability: number;
                  retainedFee: number;
                };
                observation: {
                  currency: string;
                  disputeFees: number;
                  gross: number;
                  originalProcessingFee: number;
                  paymentIntentId: string;
                  principalReturned: number;
                  processingFee: number;
                  provenance: {
                    customerAccountId: string;
                    invoiceId: string;
                    invoicePaymentId: string;
                    recoveryInvoiceItemId?: string;
                    stripePriceId?: string;
                    stripeProductId?: string;
                    subscriptionId?: string;
                  };
                  sourceChargeId: string;
                };
                rollbackClaim?: {
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
                };
              };
              scopeKey: string;
              status: "completed";
              version: number;
            }
          | {
              accountId: string;
              currency: string;
              operationId: string;
              reason: string;
              retryable: boolean;
              scopeKey: string;
              status: "not_ready" | "conflict" | "rejected" | "unknown";
              version: number;
            }
          | {
              reason: "provider_pending" | "fee_pending" | "history_incomplete";
              retryable: true;
              status: "not_ready";
            }
          | {
              reason: "scope_busy" | "revision_changed" | "identity_changed";
              retryable: false;
              status: "conflict";
            }
          | {
              reason:
                | "invalid_scope"
                | "unsupported_source"
                | "policy_invalid"
                | "payment_not_payable"
                | "currency_mismatch";
              retryable: false;
              status: "rejected";
            }
          | {
              reason: "provider_outcome_unknown" | "history_incomplete";
              retryable: false;
              status: "unknown";
            },
          Name
        >;
      };
      queries: {
        get: FunctionReference<
          "query",
          "internal",
          {
            accountId: string;
            currency: string;
            operationId: string;
            scopeKey: string;
            version: number;
          },
          | {
              accountId: string;
              currency: string;
              operationId: string;
              scopeKey: string;
              status: "queued" | "running";
              version: number;
            }
          | {
              accountId: string;
              currency: string;
              operationId: string;
              result: {
                claim: {
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
                };
                deficit: {
                  amountDue: number;
                  currency: string;
                  disputeLiability: number;
                  processingLiability: number;
                  retainedFee: number;
                };
                observation: {
                  currency: string;
                  disputeFees: number;
                  gross: number;
                  originalProcessingFee: number;
                  paymentIntentId: string;
                  principalReturned: number;
                  processingFee: number;
                  provenance: {
                    customerAccountId: string;
                    invoiceId: string;
                    invoicePaymentId: string;
                    recoveryInvoiceItemId?: string;
                    stripePriceId?: string;
                    stripeProductId?: string;
                    subscriptionId?: string;
                  };
                  sourceChargeId: string;
                };
                rollbackClaim?: {
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
                };
              };
              scopeKey: string;
              status: "completed";
              version: number;
            }
          | {
              accountId: string;
              currency: string;
              operationId: string;
              reason: string;
              retryable: boolean;
              scopeKey: string;
              status: "not_ready" | "conflict" | "rejected" | "unknown";
              version: number;
            },
          Name
        >;
        snapshot: FunctionReference<
          "query",
          "internal",
          {
            accountId: string;
            currency: string;
            operationId: string;
            scopeKey: string;
            version: number;
          },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            claimKey: string;
            currency: string;
            definitionVersion: number;
            expectedRevision: number;
            failure?:
              | {
                  reason:
                    "provider_pending" | "fee_pending" | "history_incomplete";
                  retryable: true;
                  status: "not_ready";
                }
              | {
                  reason:
                    "scope_busy" | "revision_changed" | "identity_changed";
                  retryable: false;
                  status: "conflict";
                }
              | {
                  reason:
                    | "invalid_scope"
                    | "unsupported_source"
                    | "policy_invalid"
                    | "payment_not_payable"
                    | "currency_mismatch";
                  retryable: false;
                  status: "rejected";
                }
              | {
                  reason: "provider_outcome_unknown" | "history_incomplete";
                  retryable: false;
                  status: "unknown";
                };
            importHook?: string;
            maxAttempts: number;
            policy: {
              liability: {
                disputeCosts: "all" | "none";
                processingCosts: "uncovered" | "all" | "none";
              };
              rounding: "nearest" | "floor" | "ceil";
              sellingFee: number;
            };
            projection?: string;
            provider: string;
            providerApiVersion: string;
            requestKey: string;
            result?: {
              claim: {
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
              };
              deficit: {
                amountDue: number;
                currency: string;
                disputeLiability: number;
                processingLiability: number;
                retainedFee: number;
              };
              observation: {
                currency: string;
                disputeFees: number;
                gross: number;
                originalProcessingFee: number;
                paymentIntentId: string;
                principalReturned: number;
                processingFee: number;
                provenance: {
                  customerAccountId: string;
                  invoiceId: string;
                  invoicePaymentId: string;
                  recoveryInvoiceItemId?: string;
                  stripePriceId?: string;
                  stripeProductId?: string;
                  subscriptionId?: string;
                };
                sourceChargeId: string;
              };
              rollbackClaim?: {
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
              };
            };
            retryDelayMs: number;
            rollback?: { expectedRevision: number; groupKey: string };
            scopeKey: string;
            source:
              | {
                  customerAccountId: string;
                  gross: number;
                  invoiceId?: string;
                  kind: "sale";
                  paymentIntentId: string;
                  stripeAccountId?: string;
                  stripePriceId?: string;
                  stripeProductId?: string;
                  subscriptionId?: string;
                }
              | {
                  gross: number;
                  groupKey: string;
                  kind: "invoice_recovery";
                  paymentIntentId: string;
                };
            status:
              | "queued"
              | "running"
              | "waiting"
              | "completed"
              | "conflict"
              | "rejected"
              | "unknown";
            version: number;
            workflowId?: string;
          },
          Name
        >;
      };
    };
    products: {
      mutations: {
        adoptProduct: FunctionReference<
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
        getPriceIdentity: FunctionReference<
          "query",
          "internal",
          { stripePriceId: string },
          | { status: "missing" }
          | {
              price: {
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
              };
              status: "unique";
            }
          | { status: "ambiguous" },
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
        getProductIdentity: FunctionReference<
          "query",
          "internal",
          { stripeProductId: string },
          | { status: "missing" }
          | {
              product: {
                _creationTime: number;
                _id: string;
                accountId?: string;
                active: boolean;
                description?: string;
                metadata?: any;
                name: string;
                stripeProductId: string;
              };
              status: "unique";
            }
          | { status: "ambiguous" },
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
            stripeProductId?: string;
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
    recoveryWorkflow: {
      mutations: {
        requestCancel: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            currency: string;
            groupKey: string;
            operationId: string;
            scopeKey: string;
            version: number;
          },
          {
            accountId: string;
            cancelRequested: boolean;
            currency: string;
            groupKey: string;
            operationId: string;
            outcome?: "collect" | "release";
            scopeKey: string;
            sourceId: string;
            sourceKind: "settlement" | "invoice";
            status:
              | "queued"
              | "running"
              | "waiting"
              | "unknown"
              | "completed"
              | "canceled";
            version: number;
          },
          Name
        >;
        resume: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            currency: string;
            groupKey: string;
            operationId: string;
            scopeKey: string;
            version: number;
          },
          {
            accountId: string;
            cancelRequested: boolean;
            currency: string;
            groupKey: string;
            operationId: string;
            outcome?: "collect" | "release";
            scopeKey: string;
            sourceId: string;
            sourceKind: "settlement" | "invoice";
            status:
              | "queued"
              | "running"
              | "waiting"
              | "unknown"
              | "completed"
              | "canceled";
            version: number;
          },
          Name
        >;
        start: FunctionReference<
          "mutation",
          "internal",
          {
            accountId: string;
            allocation?: {
              adjustmentAmount?: number;
              creditSource?: {
                creditGrantId: string;
                customerAccount: string;
                livemode: boolean;
                purchaseId: string;
                stripeAccountId: string;
                stripePriceId: string;
                stripeProductId: string;
              };
              currency: string;
              gross: number;
              paymentId?: string;
              paymentIntentId?: string;
              platformNet: number;
              policyContext?: {
                fields: Record<string, string>;
                namespace: string;
                version: 1;
              };
              processingFee: number;
              sourceChargeId: string;
              sourceInvoiceId?: string;
              transfers: Array<{
                amount: number;
                destinationAccountId: string;
                role: "store" | "affiliate" | "other";
              }>;
              usageSource?: {
                customerAccount: string;
                invoiceLines?: Array<{
                  amount: number;
                  kind: "fixed" | "metered";
                  lineId: string;
                  period: { end: number; start: number };
                  quantity: string;
                  stripePriceId: string;
                  stripeProductId: string;
                  subscriptionItemId: string;
                }>;
                invoicePaymentId: string;
                livemode: boolean;
                meterId: string;
                model: "pay_as_you_go" | "included_overage";
                period: { end: number; start: number };
                stripeAccountId: string;
                stripePriceId: string;
                stripeProductId: string;
                subscriptionId: string;
                subscriptionItemId: string;
              };
            };
            completion?: string;
            currency: string;
            definitionVersion: number;
            groupKey: string;
            maxAttempts: number;
            provider: string;
            providerApiVersion: string;
            releaseUncollectible: boolean;
            requestKey: string;
            retryDelayMs: number;
            scopeKey: string;
          },
          | {
              accountId: string;
              cancelRequested: boolean;
              currency: string;
              groupKey: string;
              operationId: string;
              outcome?: "collect" | "release";
              scopeKey: string;
              sourceId: string;
              sourceKind: "settlement" | "invoice";
              status:
                | "queued"
                | "running"
                | "waiting"
                | "unknown"
                | "completed"
                | "canceled";
              version: number;
            }
          | { reason: "identity_changed"; retryable: false; status: "conflict" }
          | {
              reason: "history_incomplete";
              retryable: true;
              status: "not_ready";
            },
          Name
        >;
      };
      queries: {
        get: FunctionReference<
          "query",
          "internal",
          {
            accountId: string;
            currency: string;
            groupKey: string;
            operationId: string;
            scopeKey: string;
            version: number;
          },
          {
            accountId: string;
            cancelRequested: boolean;
            currency: string;
            groupKey: string;
            operationId: string;
            outcome?: "collect" | "release";
            scopeKey: string;
            sourceId: string;
            sourceKind: "settlement" | "invoice";
            status:
              | "queued"
              | "running"
              | "waiting"
              | "unknown"
              | "completed"
              | "canceled";
            version: number;
          },
          Name
        >;
        snapshot: FunctionReference<
          "query",
          "internal",
          {
            accountId: string;
            currency: string;
            groupKey: string;
            operationId: string;
            scopeKey: string;
            version: number;
          },
          {
            _creationTime: number;
            _id: string;
            accountId: string;
            activePhase?: "execute" | "reconcile";
            allocation?: {
              adjustmentAmount?: number;
              creditSource?: {
                creditGrantId: string;
                customerAccount: string;
                livemode: boolean;
                purchaseId: string;
                stripeAccountId: string;
                stripePriceId: string;
                stripeProductId: string;
              };
              currency: string;
              gross: number;
              paymentId?: string;
              paymentIntentId?: string;
              platformNet: number;
              policyContext?: {
                fields: Record<string, string>;
                namespace: string;
                version: 1;
              };
              processingFee: number;
              sourceChargeId: string;
              sourceInvoiceId?: string;
              transfers: Array<{
                amount: number;
                destinationAccountId: string;
                role: "store" | "affiliate" | "other";
              }>;
              usageSource?: {
                customerAccount: string;
                invoiceLines?: Array<{
                  amount: number;
                  kind: "fixed" | "metered";
                  lineId: string;
                  period: { end: number; start: number };
                  quantity: string;
                  stripePriceId: string;
                  stripeProductId: string;
                  subscriptionItemId: string;
                }>;
                invoicePaymentId: string;
                livemode: boolean;
                meterId: string;
                model: "pay_as_you_go" | "included_overage";
                period: { end: number; start: number };
                stripeAccountId: string;
                stripePriceId: string;
                stripeProductId: string;
                subscriptionId: string;
                subscriptionItemId: string;
              };
            };
            cancelRequested: boolean;
            completion?: string;
            currency: string;
            definitionVersion: number;
            groupKey: string;
            maxAttempts: number;
            outcome?: "collect" | "release";
            provider: string;
            providerApiVersion: string;
            providerStarted: boolean;
            releaseUncollectible: boolean;
            resumeQueued: boolean;
            retryDelayMs: number;
            scopeKey: string;
            sourceId: string;
            sourceKind: "settlement" | "invoice";
            status:
              | "queued"
              | "running"
              | "waiting"
              | "unknown"
              | "completed"
              | "canceled";
            version: number;
            workflowId?: string;
          },
          Name
        >;
      };
    };
    refundHistory: {
      mutations: {
        normalizeRefundCommandBindings: FunctionReference<
          "mutation",
          "internal",
          { limit: number },
          { hasMore: boolean; normalized: number },
          Name
        >;
      };
      queries: {
        getRefundCommandEvidence: FunctionReference<
          "query",
          "internal",
          {
            accountId: string;
            commandKey: string;
            currency: string;
            stripeChargeId: string;
            stripePaymentIntentId: string;
          },
          | {
              refund: {
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
                refundCommandConflict?: boolean;
                refundCommandKey?: string;
                refundCommandNormalizationVersion?: 1;
                refundCommandObservedAt?: number;
                status:
                  | "pending"
                  | "requires_action"
                  | "succeeded"
                  | "failed"
                  | "canceled";
                stripeChargeId?: string;
                stripePaymentIntentId?: string;
                stripeRefundId: string;
              };
              status: "observed";
            }
          | {
              reason:
                | "missing"
                | "normalization_incomplete"
                | "ambiguous"
                | "correlation_conflict"
                | "scope_mismatch"
                | "invalid_receipt";
              status: "unavailable";
            },
          Name
        >;
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
              refundCommandConflict?: boolean;
              refundCommandKey?: string;
              refundCommandNormalizationVersion?: 1;
              refundCommandObservedAt?: number;
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
    refundSync: {
      mutations: {
        begin: FunctionReference<
          "mutation",
          "internal",
          { apiContext: string; stripeRefundId: string },
          number,
          Name
        >;
        finish: FunctionReference<
          "mutation",
          "internal",
          {
            apiContext: string;
            generation: number;
            refund: {
              accountId?: string;
              amount: number;
              currency: string;
              failureReason?: string;
              metadata?: Record<string, string>;
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
              stripeChargeId: string;
              stripePaymentIntentId: string;
              stripeRefundId: string;
            };
            stripeRefundId: string;
          },
          | {
              changed: boolean;
              generation: number;
              refund: {
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
                refundCommandConflict?: boolean;
                refundCommandKey?: string;
                refundCommandNormalizationVersion?: 1;
                refundCommandObservedAt?: number;
                status:
                  | "pending"
                  | "requires_action"
                  | "succeeded"
                  | "failed"
                  | "canceled";
                stripeChargeId?: string;
                stripePaymentIntentId?: string;
                stripeRefundId: string;
              };
              status: "accepted";
            }
          | { generation: number; status: "superseded" },
          Name
        >;
        markUnknown: FunctionReference<
          "mutation",
          "internal",
          { apiContext: string; generation: number; stripeRefundId: string },
          null,
          Name
        >;
      };
      queries: {
        routing: FunctionReference<
          "query",
          "internal",
          {
            currency: string;
            stripeChargeId: string;
            stripePaymentIntentId: string;
            stripeRefundId: string;
          },
          {
            merchantAccount: string | null;
            requiresChargeProof: boolean;
            status: "known" | "unknown" | "held";
          },
          Name
        >;
      };
    };
    reversalObservations: {
      mutations: {
        resume: FunctionReference<
          "mutation",
          "internal",
          {
            batchSize?: number;
            expectedGeneration: number;
            operationId: string;
          },
          {
            coverage: "unknown";
            generation: number | null;
            observation: {
              _creationTime: number;
              _id: string;
              deleted: boolean;
              fingerprint: string;
              generation: number;
              indexTransferGeneration: number | null;
              indexedCount: number;
              isContradictory: boolean;
              latestIdentityFingerprint: string;
              latestPayloadId: string;
              legacy: boolean;
              nextIndex: number;
              operationDigest: string;
              originalFingerprint: string;
              originalIdentityFingerprint: string;
              originalOperationId: string;
              originalPayloadId: string;
              producer: "reversal_claim_lifecycle";
              producerVersion: 1;
              referenceFingerprints: Array<string>;
              sliceCount: number;
              sourceChargeDigest: string;
              sourceCreatedAt: number;
              status: "pending" | "validating" | "complete" | "held";
            } | null;
            transferGeneration: number | null;
          },
          Name
        >;
      };
      queries: {
        bucket: FunctionReference<
          "query",
          "internal",
          {
            bucketKey: string;
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
            coverage: "unknown";
            generation: number | null;
            isDone: boolean;
            page: Array<{
              _creationTime: number;
              _id: string;
              bucketDigest?: string;
              bucketKey?: string;
              generation: number;
              identityStatus: "matched" | "unknown" | "contradictory";
              observationId: string;
              orgId?: string;
              originalOperationId: string;
              ownerDigest?: string;
              ownershipStatus:
                "registered" | "unknown" | "ambiguous" | "contradictory";
              registrationId?: string;
              sliceIndex: number;
              transferGeneration: number | null;
              transferId?: string;
              userId?: string;
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
            transferGeneration: number | null;
          },
          Name
        >;
        history: FunctionReference<
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
            selector: "operationId" | "sourceChargeId";
            value: string;
          },
          {
            continueCursor: string;
            coverage: "unknown";
            generation: number | null;
            isDone: boolean;
            page: Array<{
              _creationTime: number;
              _id: string;
              deleted: boolean;
              fingerprint: string;
              generation: number;
              indexTransferGeneration: number | null;
              indexedCount: number;
              isContradictory: boolean;
              latestIdentityFingerprint: string;
              latestPayloadId: string;
              legacy: boolean;
              nextIndex: number;
              operationDigest: string;
              originalFingerprint: string;
              originalIdentityFingerprint: string;
              originalOperationId: string;
              originalPayloadId: string;
              producer: "reversal_claim_lifecycle";
              producerVersion: 1;
              referenceFingerprints: Array<string>;
              sliceCount: number;
              sourceChargeDigest: string;
              sourceCreatedAt: number;
              status: "pending" | "validating" | "complete" | "held";
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
            transferGeneration: number | null;
          },
          Name
        >;
        operation: FunctionReference<
          "query",
          "internal",
          { operationId: string },
          {
            coverage: "unknown";
            generation: number | null;
            observation: {
              _creationTime: number;
              _id: string;
              deleted: boolean;
              fingerprint: string;
              generation: number;
              indexTransferGeneration: number | null;
              indexedCount: number;
              isContradictory: boolean;
              latestIdentityFingerprint: string;
              latestPayloadId: string;
              legacy: boolean;
              nextIndex: number;
              operationDigest: string;
              originalFingerprint: string;
              originalIdentityFingerprint: string;
              originalOperationId: string;
              originalPayloadId: string;
              producer: "reversal_claim_lifecycle";
              producerVersion: 1;
              referenceFingerprints: Array<string>;
              sliceCount: number;
              sourceChargeDigest: string;
              sourceCreatedAt: number;
              status: "pending" | "validating" | "complete" | "held";
            } | null;
            transferGeneration: number | null;
          },
          Name
        >;
        owner: FunctionReference<
          "query",
          "internal",
          {
            orgId?: string;
            paginationOpts: {
              cursor: string | null;
              endCursor?: string | null;
              id?: number;
              maximumBytesRead?: number;
              maximumRowsRead?: number;
              numItems: number;
            };
            userId: string;
          },
          {
            continueCursor: string;
            coverage: "unknown";
            generation: number | null;
            isDone: boolean;
            page: Array<{
              _creationTime: number;
              _id: string;
              bucketDigest?: string;
              bucketKey?: string;
              generation: number;
              identityStatus: "matched" | "unknown" | "contradictory";
              observationId: string;
              orgId?: string;
              originalOperationId: string;
              ownerDigest?: string;
              ownershipStatus:
                "registered" | "unknown" | "ambiguous" | "contradictory";
              registrationId?: string;
              sliceIndex: number;
              transferGeneration: number | null;
              transferId?: string;
              userId?: string;
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
            transferGeneration: number | null;
          },
          Name
        >;
        payload: FunctionReference<
          "query",
          "internal",
          { operationId: string; version: "original" | "latest" },
          {
            coverage: "unknown";
            generation: number | null;
            payload: {
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
            } | null;
            transferGeneration: number | null;
          },
          Name
        >;
        slices: FunctionReference<
          "query",
          "internal",
          {
            operationId: string;
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
            coverage: "unknown";
            generation: number | null;
            isDone: boolean;
            page: Array<{
              _creationTime: number;
              _id: string;
              bucketDigest?: string;
              bucketKey?: string;
              generation: number;
              identityStatus: "matched" | "unknown" | "contradictory";
              observationId: string;
              orgId?: string;
              originalOperationId: string;
              ownerDigest?: string;
              ownershipStatus:
                "registered" | "unknown" | "ambiguous" | "contradictory";
              registrationId?: string;
              sliceIndex: number;
              transferGeneration: number | null;
              transferId?: string;
              userId?: string;
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
            transferGeneration: number | null;
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
            creditSource?: {
              creditGrantId: string;
              customerAccount: string;
              livemode: boolean;
              purchaseId: string;
              stripeAccountId: string;
              stripePriceId: string;
              stripeProductId: string;
            };
            currency: string;
            gross: number;
            paymentId?: string;
            paymentIntentId?: string;
            platformNet: number;
            policyContext?: {
              fields: Record<string, string>;
              namespace: string;
              version: 1;
            };
            processingFee: number;
            sourceChargeId: string;
            sourceInvoiceId?: string;
            transfers: Array<{
              amount: number;
              destinationAccountId: string;
              role: "store" | "affiliate" | "other";
            }>;
            usageSource?: {
              customerAccount: string;
              invoiceLines?: Array<{
                amount: number;
                kind: "fixed" | "metered";
                lineId: string;
                period: { end: number; start: number };
                quantity: string;
                stripePriceId: string;
                stripeProductId: string;
                subscriptionItemId: string;
              }>;
              invoicePaymentId: string;
              livemode: boolean;
              meterId: string;
              model: "pay_as_you_go" | "included_overage";
              period: { end: number; start: number };
              stripeAccountId: string;
              stripePriceId: string;
              stripeProductId: string;
              subscriptionId: string;
              subscriptionItemId: string;
            };
          },
          {
            _creationTime: number;
            _id: string;
            adjustmentAmount?: number;
            creditSource?: {
              creditGrantId: string;
              customerAccount: string;
              livemode: boolean;
              purchaseId: string;
              stripeAccountId: string;
              stripePriceId: string;
              stripeProductId: string;
            };
            currency: string;
            gross: number;
            paymentId?: string;
            paymentIntentId?: string;
            platformNet: number;
            policyContext?: {
              fields: Record<string, string>;
              namespace: string;
              version: 1;
            };
            processingFee: number;
            sourceChargeId: string;
            sourceInvoiceId?: string;
            transfers: Array<{
              amount: number;
              destinationAccountId: string;
              role: "store" | "affiliate" | "other";
            }>;
            usageSource?: {
              customerAccount: string;
              invoiceLines?: Array<{
                amount: number;
                kind: "fixed" | "metered";
                lineId: string;
                period: { end: number; start: number };
                quantity: string;
                stripePriceId: string;
                stripeProductId: string;
                subscriptionItemId: string;
              }>;
              invoicePaymentId: string;
              livemode: boolean;
              meterId: string;
              model: "pay_as_you_go" | "included_overage";
              period: { end: number; start: number };
              stripeAccountId: string;
              stripePriceId: string;
              stripeProductId: string;
              subscriptionId: string;
              subscriptionItemId: string;
            };
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
            creditSource?: {
              creditGrantId: string;
              customerAccount: string;
              livemode: boolean;
              purchaseId: string;
              stripeAccountId: string;
              stripePriceId: string;
              stripeProductId: string;
            };
            currency: string;
            gross: number;
            paymentId?: string;
            paymentIntentId?: string;
            platformNet: number;
            policyContext?: {
              fields: Record<string, string>;
              namespace: string;
              version: 1;
            };
            processingFee: number;
            sourceChargeId: string;
            sourceInvoiceId?: string;
            transfers: Array<{
              amount: number;
              destinationAccountId: string;
              role: "store" | "affiliate" | "other";
            }>;
            usageSource?: {
              customerAccount: string;
              invoiceLines?: Array<{
                amount: number;
                kind: "fixed" | "metered";
                lineId: string;
                period: { end: number; start: number };
                quantity: string;
                stripePriceId: string;
                stripeProductId: string;
                subscriptionItemId: string;
              }>;
              invoicePaymentId: string;
              livemode: boolean;
              meterId: string;
              model: "pay_as_you_go" | "included_overage";
              period: { end: number; start: number };
              stripeAccountId: string;
              stripePriceId: string;
              stripeProductId: string;
              subscriptionId: string;
              subscriptionItemId: string;
            };
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
    usage: {
      mutations: {
        record: FunctionReference<
          "mutation",
          "internal",
          {
            dispatch?: string;
            inputJson: string;
            quota?: number;
            reservationId?: string;
            subscriptionJson: string;
          },
          {
            acceptedAt: number;
            delivery: "queued";
            eventId: string;
            identity: string;
          },
          Name
        >;
      };
      queries: {
        get: FunctionReference<
          "query",
          "internal",
          {
            eventId: string;
            scope: {
              customerAccount: string;
              livemode: boolean;
              meterId: string;
              stripeAccountId: string;
            };
          },
          {
            delivery:
              | "queued"
              | "canceled"
              | "sending"
              | "provider_accepted"
              | "rejected"
              | "unknown"
              | "held";
            event: {
              _creationTime: number;
              _id: string;
              acceptedAt: number;
              identity: string;
              occurredAt: number;
              recordJson: string;
              reservationId?: string;
              scopeKey: string;
              subscriptionId?: string;
              subscriptionJson: string;
            };
          } | null,
          Name
        >;
        read: FunctionReference<
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
            period: { end: number; start: number };
            scope: {
              customerAccount: string;
              livemode: boolean;
              meterId: string;
              stripeAccountId: string;
            };
          },
          {
            continueCursor: string;
            isDone: boolean;
            page: Array<{
              delivery:
                | "queued"
                | "canceled"
                | "sending"
                | "provider_accepted"
                | "rejected"
                | "unknown"
                | "held";
              event: {
                _creationTime: number;
                _id: string;
                acceptedAt: number;
                identity: string;
                occurredAt: number;
                recordJson: string;
                reservationId?: string;
                scopeKey: string;
                subscriptionId?: string;
                subscriptionJson: string;
              };
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
          },
          Name
        >;
      };
    };
    usageAllowance: {
      mutations: {
        configure: FunctionReference<
          "mutation",
          "internal",
          { bindingJson: string; expectedRevision: number; policyJson: string },
          { revision: number },
          Name
        >;
        release: FunctionReference<
          "mutation",
          "internal",
          {
            reason: "work_failed" | "abandoned_before_work";
            reservationId: string;
            scope: {
              customerAccount: string;
              livemode: boolean;
              meterId: string;
              stripeAccountId: string;
            };
          },
          null,
          Name
        >;
        reserve: FunctionReference<
          "mutation",
          "internal",
          { inputJson: string; subscriptionJson: string },
          | {
              reason: "not_entitled" | "hard_limit";
              revision: number;
              state: "denied";
            }
          | {
              reservationId: string;
              revision: number;
              state: "reserved" | "committed" | "released";
            },
          Name
        >;
      };
      queries: {
        readHistory: FunctionReference<
          "query",
          "internal",
          {
            bindingJson: string;
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
              at: number;
              evidenceJson: string;
              key: string;
              kind:
                "policy" | "reservation" | "commit" | "release" | "correction";
            }>;
          },
          Name
        >;
        reconciliation: FunctionReference<
          "query",
          "internal",
          { bindingJson: string },
          {
            acceptedScaledQuantity: string;
            consumedScaledQuantity: string;
            reason: string;
            repaired: false;
            reservedScaledQuantity: string;
            status: "matched" | "held";
          },
          Name
        >;
        status: FunctionReference<
          "query",
          "internal",
          { bindingJson: string },
          string | null,
          Name
        >;
      };
    };
    usageCatalog: {
      mutations: {
        complete: FunctionReference<
          "mutation",
          "internal",
          {
            key: string;
            kind: "meter" | "price";
            observationJson: string;
            providerId: string;
            scopeKey: string;
          },
          null,
          Name
        >;
        prepare: FunctionReference<
          "mutation",
          "internal",
          {
            key: string;
            kind: "meter" | "price";
            scopeKey: string;
            termsJson: string;
          },
          {
            _creationTime: number;
            _id: string;
            firstAttemptAt: number;
            key: string;
            kind: "meter" | "price";
            observationJson?: string;
            observedAt?: number;
            providerId?: string;
            scopeKey: string;
            termsJson: string;
          },
          Name
        >;
      };
      queries: {
        get: FunctionReference<
          "query",
          "internal",
          { key: string; kind: "meter" | "price"; scopeKey: string },
          {
            _creationTime: number;
            _id: string;
            firstAttemptAt: number;
            key: string;
            kind: "meter" | "price";
            observationJson?: string;
            observedAt?: number;
            providerId?: string;
            scopeKey: string;
            termsJson: string;
          } | null,
          Name
        >;
        getByProvider: FunctionReference<
          "query",
          "internal",
          { kind: "meter" | "price"; providerId: string; scopeKey: string },
          {
            _creationTime: number;
            _id: string;
            firstAttemptAt: number;
            key: string;
            kind: "meter" | "price";
            observationJson?: string;
            observedAt?: number;
            providerId?: string;
            scopeKey: string;
            termsJson: string;
          } | null,
          Name
        >;
      };
    };
    usageCorrections: {
      mutations: {
        adopt: FunctionReference<
          "mutation",
          "internal",
          { key: string; proofJson: string },
          {
            _creationTime: number;
            _id: string;
            adjustmentJson?: string;
            attempt: number;
            attemptedAt?: number;
            cashConsequence:
              | "none"
              | "operator_resolution_required"
              | "verified_external_adjustment";
            correctionId: string;
            creditNoteId?: string;
            customerAccount?: string;
            eventId: string;
            firstAttemptAt: number;
            historyCount: number;
            inputJson: string;
            invoiceId?: string;
            key: string;
            leaseUntil?: number;
            nativeAdjustmentId?: string;
            nativeCreditNoteStatus?: "issued" | "void";
            nativeStatus?: "pending" | "complete";
            observedAt?: number;
            quantity: string;
            reason: string;
            recordJson: string;
            refundId?: string;
            resolution?: "event_cancellation" | "invoice_credit";
            restoredQuantity: string;
            scaledQuantity: string;
            scopeKey: string;
            state:
              | "requested"
              | "provider_accepted"
              | "confirmed"
              | "held"
              | "unsupported"
              | "invoice_adjustment_required";
            stripeAccountId?: string;
            subscriptionJson: string;
          },
          Name
        >;
        claim: FunctionReference<
          "mutation",
          "internal",
          { key: string },
          { attempt: number; kind: "ready" | "busy" | "done" },
          Name
        >;
        prepare: FunctionReference<
          "mutation",
          "internal",
          { inputJson: string },
          {
            _creationTime: number;
            _id: string;
            adjustmentJson?: string;
            attempt: number;
            attemptedAt?: number;
            cashConsequence:
              | "none"
              | "operator_resolution_required"
              | "verified_external_adjustment";
            correctionId: string;
            creditNoteId?: string;
            customerAccount?: string;
            eventId: string;
            firstAttemptAt: number;
            historyCount: number;
            inputJson: string;
            invoiceId?: string;
            key: string;
            leaseUntil?: number;
            nativeAdjustmentId?: string;
            nativeCreditNoteStatus?: "issued" | "void";
            nativeStatus?: "pending" | "complete";
            observedAt?: number;
            quantity: string;
            reason: string;
            recordJson: string;
            refundId?: string;
            resolution?: "event_cancellation" | "invoice_credit";
            restoredQuantity: string;
            scaledQuantity: string;
            scopeKey: string;
            state:
              | "requested"
              | "provider_accepted"
              | "confirmed"
              | "held"
              | "unsupported"
              | "invoice_adjustment_required";
            stripeAccountId?: string;
            subscriptionJson: string;
          },
          Name
        >;
        save: FunctionReference<
          "mutation",
          "internal",
          { attempt: number; key: string; outcomeJson: string },
          {
            _creationTime: number;
            _id: string;
            adjustmentJson?: string;
            attempt: number;
            attemptedAt?: number;
            cashConsequence:
              | "none"
              | "operator_resolution_required"
              | "verified_external_adjustment";
            correctionId: string;
            creditNoteId?: string;
            customerAccount?: string;
            eventId: string;
            firstAttemptAt: number;
            historyCount: number;
            inputJson: string;
            invoiceId?: string;
            key: string;
            leaseUntil?: number;
            nativeAdjustmentId?: string;
            nativeCreditNoteStatus?: "issued" | "void";
            nativeStatus?: "pending" | "complete";
            observedAt?: number;
            quantity: string;
            reason: string;
            recordJson: string;
            refundId?: string;
            resolution?: "event_cancellation" | "invoice_credit";
            restoredQuantity: string;
            scaledQuantity: string;
            scopeKey: string;
            state:
              | "requested"
              | "provider_accepted"
              | "confirmed"
              | "held"
              | "unsupported"
              | "invoice_adjustment_required";
            stripeAccountId?: string;
            subscriptionJson: string;
          },
          Name
        >;
      };
      queries: {
        get: FunctionReference<
          "query",
          "internal",
          {
            correctionId: string;
            eventId: string;
            scope: {
              customerAccount: string;
              livemode: boolean;
              meterId: string;
              stripeAccountId: string;
            };
          },
          {
            _creationTime: number;
            _id: string;
            adjustmentJson?: string;
            attempt: number;
            attemptedAt?: number;
            cashConsequence:
              | "none"
              | "operator_resolution_required"
              | "verified_external_adjustment";
            correctionId: string;
            creditNoteId?: string;
            customerAccount?: string;
            eventId: string;
            firstAttemptAt: number;
            historyCount: number;
            inputJson: string;
            invoiceId?: string;
            key: string;
            leaseUntil?: number;
            nativeAdjustmentId?: string;
            nativeCreditNoteStatus?: "issued" | "void";
            nativeStatus?: "pending" | "complete";
            observedAt?: number;
            quantity: string;
            reason: string;
            recordJson: string;
            refundId?: string;
            resolution?: "event_cancellation" | "invoice_credit";
            restoredQuantity: string;
            scaledQuantity: string;
            scopeKey: string;
            state:
              | "requested"
              | "provider_accepted"
              | "confirmed"
              | "held"
              | "unsupported"
              | "invoice_adjustment_required";
            stripeAccountId?: string;
            subscriptionJson: string;
          } | null,
          Name
        >;
        periodHistory: FunctionReference<
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
            period: { end: number; start: number };
            scope: {
              customerAccount: string;
              livemode: boolean;
              meterId: string;
              stripeAccountId: string;
            };
          },
          {
            continueCursor: string;
            isDone: boolean;
            legacyHistoryMissing: boolean;
            page: Array<{
              _creationTime: number;
              _id: string;
              at: number;
              eventId: string;
              evidenceJson: string;
              key: string;
              occurredAt?: number;
              reason: string;
              recordJson: string;
              scopeKey: string;
              sequence: number;
              state:
                | "requested"
                | "provider_accepted"
                | "confirmed"
                | "held"
                | "unsupported"
                | "invoice_adjustment_required";
              subscriptionJson: string;
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
          },
          Name
        >;
        readHistory: FunctionReference<
          "query",
          "internal",
          {
            eventId: string;
            paginationOpts: {
              cursor: string | null;
              endCursor?: string | null;
              id?: number;
              maximumBytesRead?: number;
              maximumRowsRead?: number;
              numItems: number;
            };
            scope: {
              customerAccount: string;
              livemode: boolean;
              meterId: string;
              stripeAccountId: string;
            };
          },
          {
            continueCursor: string;
            isDone: boolean;
            page: Array<{
              _creationTime: number;
              _id: string;
              at: number;
              eventId: string;
              evidenceJson: string;
              key: string;
              occurredAt?: number;
              reason: string;
              recordJson: string;
              scopeKey: string;
              sequence: number;
              state:
                | "requested"
                | "provider_accepted"
                | "confirmed"
                | "held"
                | "unsupported"
                | "invoice_adjustment_required";
              subscriptionJson: string;
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
          },
          Name
        >;
      };
    };
    usageCredits: {
      mutations: {
        beginObservation: FunctionReference<
          "mutation",
          "internal",
          { inputJson: string },
          number,
          Name
        >;
        cancelPurchase: FunctionReference<
          "mutation",
          "internal",
          { key: string; paymentIntentId: string },
          null,
          Name
        >;
        cancelUnstarted: FunctionReference<
          "mutation",
          "internal",
          { key: string },
          null,
          Name
        >;
        closeAccount: FunctionReference<
          "mutation",
          "internal",
          { bindingJson: string },
          null,
          Name
        >;
        freezePurchase: FunctionReference<
          "mutation",
          "internal",
          {
            key: string;
            paymentIntentId: string;
            reason:
              "payment_refunded" | "payment_disputed" | "native_state_changed";
            refundedAmount?: number;
          },
          null,
          Name
        >;
        markPaymentAttempt: FunctionReference<
          "mutation",
          "internal",
          { key: string },
          null,
          Name
        >;
        pinGrant: FunctionReference<
          "mutation",
          "internal",
          { key: string; proofJson: string },
          null,
          Name
        >;
        pinPayment: FunctionReference<
          "mutation",
          "internal",
          { key: string; paymentIntentId: string },
          null,
          Name
        >;
        preparePurchase: FunctionReference<
          "mutation",
          "internal",
          { inputJson: string },
          {
            _creationTime: number;
            _id: string;
            accountKey: string;
            capacityReserved: boolean;
            creditGrantId?: string;
            firstAttemptAt: number;
            grantFirstAttemptAt?: number;
            key: string;
            nativeCustomerKey: string;
            paymentAttemptedAt?: number;
            paymentIntentId?: string;
            paymentKey?: string;
            paymentProofJson?: string;
            recoveryReason?:
              "payment_refunded" | "payment_disputed" | "native_state_changed";
            refundedAmount?: number;
            state: "pending" | "ready" | "frozen" | "canceled";
            termsJson: string;
          },
          Name
        >;
        prepareRefund: FunctionReference<
          "mutation",
          "internal",
          { key: string },
          null,
          Name
        >;
        release: FunctionReference<
          "mutation",
          "internal",
          {
            reason: "work_failed" | "abandoned_before_work";
            reservationId: string;
            scope: {
              customerAccount: string;
              livemode: boolean;
              meterId: string;
              stripeAccountId: string;
            };
          },
          null,
          Name
        >;
        reserve: FunctionReference<
          "mutation",
          "internal",
          { inputJson: string; subscriptionJson: string },
          {
            reservationId: string;
            state: "reserved" | "committed" | "released";
          },
          Name
        >;
        resumeAccount: FunctionReference<
          "mutation",
          "internal",
          { bindingJson: string },
          null,
          Name
        >;
        saveObservation: FunctionReference<
          "mutation",
          "internal",
          {
            inputJson: string;
            proofJson: string;
            proofStartedAt?: number;
            startedAt: number;
          },
          string,
          Name
        >;
        verifyPayment: FunctionReference<
          "mutation",
          "internal",
          { key: string; proofJson: string },
          null,
          Name
        >;
      };
      queries: {
        balance: FunctionReference<
          "query",
          "internal",
          { bindingJson: string },
          {
            availableQuantity: string;
            cashCollection: "none";
            consumedQuantity: string;
            currency: string;
            expiredQuantity: string;
            frozenQuantity: string;
            precision: number;
            reservedQuantity: string;
            status: "available" | "held";
            unit: string;
          },
          Name
        >;
        capacity: FunctionReference<
          "query",
          "internal",
          { bindingJson: string },
          number,
          Name
        >;
        context: FunctionReference<
          "query",
          "internal",
          { bindingJson: string },
          {
            _creationTime: number;
            _id: string;
            abandonedId?: string;
            checkoutId?: string;
            controlKey?: string;
            firstAttemptAt: number;
            historyCount?: number;
            key: string;
            method: "direct" | "checkout";
            observationStartedAt?: number;
            providerId?: string;
            retiredAt?: number;
            retirementInvoiceId?: string;
            scopeKey: string;
            startedAt?: number;
            termsJson: string;
            viewJson?: string;
          },
          Name
        >;
        deliveryBacking: FunctionReference<
          "query",
          "internal",
          {
            eventId: string;
            scope: {
              customerAccount: string;
              livemode: boolean;
              meterId: string;
              stripeAccountId: string;
            };
          },
          {
            grants: Array<{
              _creationTime: number;
              _id: string;
              accountKey: string;
              available: string;
              chargeId: string;
              consumed: string;
              creditGrantId: string;
              effectiveAt: number;
              expiresAt: number | null;
              frozen: boolean;
              nativeCreated: number;
              nativeCustomerKey: string;
              nativeExpired?: boolean;
              nativeObservationJson?: string;
              nativeUnused: boolean;
              observationConflictAt?: number;
              observationStartedAt?: number;
              observedAt?: number;
              paymentIntentId: string;
              proofJson: string;
              proofStartedAt?: number;
              purchaseKey: string;
              reserved: string;
            }>;
            held: boolean;
            purchases: Array<{
              _creationTime: number;
              _id: string;
              accountKey: string;
              capacityReserved: boolean;
              creditGrantId?: string;
              firstAttemptAt: number;
              grantFirstAttemptAt?: number;
              key: string;
              nativeCustomerKey: string;
              paymentAttemptedAt?: number;
              paymentIntentId?: string;
              paymentKey?: string;
              paymentProofJson?: string;
              recoveryReason?:
                | "payment_refunded"
                | "payment_disputed"
                | "native_state_changed";
              refundedAmount?: number;
              state: "pending" | "ready" | "frozen" | "canceled";
              termsJson: string;
            }>;
          },
          Name
        >;
        getByKey: FunctionReference<
          "query",
          "internal",
          { key: string },
          {
            _creationTime: number;
            _id: string;
            accountKey: string;
            capacityReserved: boolean;
            creditGrantId?: string;
            firstAttemptAt: number;
            grantFirstAttemptAt?: number;
            key: string;
            nativeCustomerKey: string;
            paymentAttemptedAt?: number;
            paymentIntentId?: string;
            paymentKey?: string;
            paymentProofJson?: string;
            recoveryReason?:
              "payment_refunded" | "payment_disputed" | "native_state_changed";
            refundedAmount?: number;
            state: "pending" | "ready" | "frozen" | "canceled";
            termsJson: string;
          } | null,
          Name
        >;
        getPurchase: FunctionReference<
          "query",
          "internal",
          { bindingJson: string; purchaseId: string },
          {
            _creationTime: number;
            _id: string;
            accountKey: string;
            capacityReserved: boolean;
            creditGrantId?: string;
            firstAttemptAt: number;
            grantFirstAttemptAt?: number;
            key: string;
            nativeCustomerKey: string;
            paymentAttemptedAt?: number;
            paymentIntentId?: string;
            paymentKey?: string;
            paymentProofJson?: string;
            recoveryReason?:
              "payment_refunded" | "payment_disputed" | "native_state_changed";
            refundedAmount?: number;
            state: "pending" | "ready" | "frozen" | "canceled";
            termsJson: string;
          } | null,
          Name
        >;
        invoiceUsage: FunctionReference<
          "query",
          "internal",
          {
            bindingJson: string;
            end: number;
            start: number;
            subscriptionId: string;
            subscriptionItemId: string;
          },
          { complete: boolean; scaledQuantity: string; valid: boolean },
          Name
        >;
        readGrants: FunctionReference<
          "query",
          "internal",
          {
            bindingJson: string;
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
              accountKey: string;
              available: string;
              chargeId: string;
              consumed: string;
              creditGrantId: string;
              effectiveAt: number;
              expiresAt: number | null;
              frozen: boolean;
              nativeCreated: number;
              nativeCustomerKey: string;
              nativeExpired?: boolean;
              nativeObservationJson?: string;
              nativeUnused: boolean;
              observationConflictAt?: number;
              observationStartedAt?: number;
              observedAt?: number;
              paymentIntentId: string;
              proofJson: string;
              proofStartedAt?: number;
              purchaseKey: string;
              reserved: string;
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
          },
          Name
        >;
        readHistory: FunctionReference<
          "query",
          "internal",
          {
            bindingJson: string;
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
              accountKey: string;
              at: number;
              evidenceJson: string;
              fingerprint: string;
              kind:
                | "purchase"
                | "payment"
                | "grant"
                | "reservation"
                | "commit"
                | "release"
                | "observation"
                | "recovery"
                | "closure"
                | "correction";
              purchaseKey?: string;
              sourceKey: string;
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
          },
          Name
        >;
      };
    };
    usageDelivery: {
      mutations: {
        hold: FunctionReference<
          "mutation",
          "internal",
          {
            eventId: string;
            scope: {
              customerAccount: string;
              livemode: boolean;
              meterId: string;
              stripeAccountId: string;
            };
          },
          {
            attempts: number;
            eventId: string;
            held: boolean;
            providerIdentifier: string;
            reason?:
              | "usage_canceled"
              | "billing_period_closed"
              | "rate_limited"
              | "provider_unavailable"
              | "provider_outcome_unknown"
              | "provider_rejected"
              | "retry_exhausted"
              | "delivery_window_expired"
              | "scope_busy"
              | "administrative_hold";
            receipt?: { created: number; identifier: string };
            state:
              | "queued"
              | "canceled"
              | "sending"
              | "provider_accepted"
              | "rejected"
              | "unknown"
              | "held";
            validationErrors: Array<{
              code:
                | "meter_event_customer_not_found"
                | "meter_event_no_customer_defined"
                | "meter_event_dimension_count_too_high"
                | "archived_meter"
                | "timestamp_too_far_in_past"
                | "timestamp_in_future"
                | "meter_event_value_not_found"
                | "meter_event_invalid_value"
                | "no_meter";
              observedAt: number;
              providerEventId: string;
            }>;
            validationHistoryComplete: boolean;
          },
          Name
        >;
        recordErrorReport: FunctionReference<
          "mutation",
          "internal",
          {
            livemode: boolean;
            meterId?: string;
            providerEventId: string;
            samples: Array<{
              code:
                | "meter_event_customer_not_found"
                | "meter_event_no_customer_defined"
                | "meter_event_dimension_count_too_high"
                | "archived_meter"
                | "timestamp_too_far_in_past"
                | "timestamp_in_future"
                | "meter_event_value_not_found"
                | "meter_event_invalid_value"
                | "no_meter";
              identifier: string;
            }>;
            stripeAccountId: string;
            truncated: boolean;
          },
          { matched: number; truncated: boolean; unattributed: number },
          Name
        >;
        resume: FunctionReference<
          "mutation",
          "internal",
          {
            eventId: string;
            scope: {
              customerAccount: string;
              livemode: boolean;
              meterId: string;
              stripeAccountId: string;
            };
          },
          {
            attempts: number;
            eventId: string;
            held: boolean;
            providerIdentifier: string;
            reason?:
              | "usage_canceled"
              | "billing_period_closed"
              | "rate_limited"
              | "provider_unavailable"
              | "provider_outcome_unknown"
              | "provider_rejected"
              | "retry_exhausted"
              | "delivery_window_expired"
              | "scope_busy"
              | "administrative_hold";
            receipt?: { created: number; identifier: string };
            state:
              | "queued"
              | "canceled"
              | "sending"
              | "provider_accepted"
              | "rejected"
              | "unknown"
              | "held";
            validationErrors: Array<{
              code:
                | "meter_event_customer_not_found"
                | "meter_event_no_customer_defined"
                | "meter_event_dimension_count_too_high"
                | "archived_meter"
                | "timestamp_too_far_in_past"
                | "timestamp_in_future"
                | "meter_event_value_not_found"
                | "meter_event_invalid_value"
                | "no_meter";
              observedAt: number;
              providerEventId: string;
            }>;
            validationHistoryComplete: boolean;
          },
          Name
        >;
        start: FunctionReference<
          "mutation",
          "internal",
          {
            definitionVersion: 1;
            eventId: string;
            provider: string;
            scope: {
              customerAccount: string;
              livemode: boolean;
              meterId: string;
              stripeAccountId: string;
            };
          },
          {
            attempts: number;
            eventId: string;
            held: boolean;
            providerIdentifier: string;
            reason?:
              | "usage_canceled"
              | "billing_period_closed"
              | "rate_limited"
              | "provider_unavailable"
              | "provider_outcome_unknown"
              | "provider_rejected"
              | "retry_exhausted"
              | "delivery_window_expired"
              | "scope_busy"
              | "administrative_hold";
            receipt?: { created: number; identifier: string };
            state:
              | "queued"
              | "canceled"
              | "sending"
              | "provider_accepted"
              | "rejected"
              | "unknown"
              | "held";
            validationErrors: Array<{
              code:
                | "meter_event_customer_not_found"
                | "meter_event_no_customer_defined"
                | "meter_event_dimension_count_too_high"
                | "archived_meter"
                | "timestamp_too_far_in_past"
                | "timestamp_in_future"
                | "meter_event_value_not_found"
                | "meter_event_invalid_value"
                | "no_meter";
              observedAt: number;
              providerEventId: string;
            }>;
            validationHistoryComplete: boolean;
          },
          Name
        >;
      };
      queries: {
        get: FunctionReference<
          "query",
          "internal",
          {
            eventId: string;
            scope: {
              customerAccount: string;
              livemode: boolean;
              meterId: string;
              stripeAccountId: string;
            };
          },
          {
            attempts: number;
            eventId: string;
            held: boolean;
            providerIdentifier: string;
            reason?:
              | "usage_canceled"
              | "billing_period_closed"
              | "rate_limited"
              | "provider_unavailable"
              | "provider_outcome_unknown"
              | "provider_rejected"
              | "retry_exhausted"
              | "delivery_window_expired"
              | "scope_busy"
              | "administrative_hold";
            receipt?: { created: number; identifier: string };
            state:
              | "queued"
              | "canceled"
              | "sending"
              | "provider_accepted"
              | "rejected"
              | "unknown"
              | "held";
            validationErrors: Array<{
              code:
                | "meter_event_customer_not_found"
                | "meter_event_no_customer_defined"
                | "meter_event_dimension_count_too_high"
                | "archived_meter"
                | "timestamp_too_far_in_past"
                | "timestamp_in_future"
                | "meter_event_value_not_found"
                | "meter_event_invalid_value"
                | "no_meter";
              observedAt: number;
              providerEventId: string;
            }>;
            validationHistoryComplete: boolean;
          },
          Name
        >;
        snapshot: FunctionReference<
          "query",
          "internal",
          {
            eventId: string;
            scope: {
              customerAccount: string;
              livemode: boolean;
              meterId: string;
              stripeAccountId: string;
            };
          },
          {
            billingCutoff: number | null;
            event: {
              _creationTime: number;
              _id: string;
              acceptedAt: number;
              identity: string;
              occurredAt: number;
              recordJson: string;
              reservationId?: string;
              scopeKey: string;
              subscriptionId?: string;
              subscriptionJson: string;
            };
            managedCollection: null | {
              daysUntilDue: number | null;
              defaultPaymentMethod: string | null;
              method: "send_invoice" | "charge_automatically";
            };
            outbox: {
              _creationTime: number;
              _id: string;
              attempts: number;
              correctionKey?: string;
              definitionVersion?: 1;
              dispatch?: string;
              eventId: string;
              firstSendAt?: number;
              held?: boolean;
              historySequence?: number;
              leaseUntil?: number;
              nextAttemptAt: number;
              provider?: string;
              providerIdentifier: string;
              reason?:
                | "usage_canceled"
                | "billing_period_closed"
                | "rate_limited"
                | "provider_unavailable"
                | "provider_outcome_unknown"
                | "provider_rejected"
                | "retry_exhausted"
                | "delivery_window_expired"
                | "scope_busy"
                | "administrative_hold";
              receipt?: { created: number; identifier: string };
              scopeKey: string;
              state:
                | "queued"
                | "canceled"
                | "sending"
                | "provider_accepted"
                | "rejected"
                | "unknown"
                | "held";
              workflowId?: string;
            };
          },
          Name
        >;
      };
    };
    usageObservations: {
      mutations: {
        save: FunctionReference<
          "mutation",
          "internal",
          { observationJson: string; sourceJson: string; startedAt: number },
          null,
          Name
        >;
      };
      queries: {
        cached: FunctionReference<
          "query",
          "internal",
          { sourceJson: string },
          string | null,
          Name
        >;
        deliveryHistory: FunctionReference<
          "query",
          "internal",
          {
            eventId: string;
            paginationOpts: {
              cursor: string | null;
              endCursor?: string | null;
              id?: number;
              maximumBytesRead?: number;
              maximumRowsRead?: number;
              numItems: number;
            };
            scope: {
              customerAccount: string;
              livemode: boolean;
              meterId: string;
              stripeAccountId: string;
            };
          },
          {
            continueCursor: string;
            isDone: boolean;
            legacyHistoryMissing: boolean;
            page: Array<{
              _creationTime: number;
              _id: string;
              attempt: number;
              created?: number;
              eventId: string;
              identity: string;
              phase:
                | "started"
                | "accepted"
                | "rate_limited"
                | "unavailable"
                | "unknown"
                | "rejected"
                | "held"
                | "resumed"
                | "window_expired"
                | "retry_exhausted";
              recordedAt: number;
              scopeKey: string;
              sequence: number;
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
          },
          Name
        >;
        summary: FunctionReference<
          "query",
          "internal",
          {
            maxRecords: number;
            period: { end: number; start: number };
            scope: {
              customerAccount: string;
              livemode: boolean;
              meterId: string;
              stripeAccountId: string;
            };
          },
          string,
          Name
        >;
        validationHistory: FunctionReference<
          "query",
          "internal",
          {
            eventId: string;
            paginationOpts: {
              cursor: string | null;
              endCursor?: string | null;
              id?: number;
              maximumBytesRead?: number;
              maximumRowsRead?: number;
              numItems: number;
            };
            scope: {
              customerAccount: string;
              livemode: boolean;
              meterId: string;
              stripeAccountId: string;
            };
          },
          {
            continueCursor: string;
            isDone: boolean;
            page: Array<{
              _creationTime: number;
              _id: string;
              code:
                | "meter_event_customer_not_found"
                | "meter_event_no_customer_defined"
                | "meter_event_dimension_count_too_high"
                | "archived_meter"
                | "timestamp_too_far_in_past"
                | "timestamp_in_future"
                | "meter_event_value_not_found"
                | "meter_event_invalid_value"
                | "no_meter";
              dedupe: string;
              eventId: string;
              observedAt: number;
              providerEventId: string;
              scopeKey: string;
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
          },
          Name
        >;
      };
    };
    usageSubscriptions: {
      mutations: {
        abandon: FunctionReference<
          "mutation",
          "internal",
          { key: string; proofJson: string },
          null,
          Name
        >;
        beginObservation: FunctionReference<
          "mutation",
          "internal",
          { key: string },
          number,
          Name
        >;
        completeCancellation: FunctionReference<
          "mutation",
          "internal",
          { key: string; nativeJson: string; startedAt: number },
          string,
          Name
        >;
        linkCheckout: FunctionReference<
          "mutation",
          "internal",
          { checkoutId: string; key: string },
          null,
          Name
        >;
        prepare: FunctionReference<
          "mutation",
          "internal",
          { method: "direct" | "checkout"; termsJson: string },
          {
            _creationTime: number;
            _id: string;
            abandonedId?: string;
            checkoutId?: string;
            controlKey?: string;
            firstAttemptAt: number;
            historyCount?: number;
            key: string;
            method: "direct" | "checkout";
            observationStartedAt?: number;
            providerId?: string;
            retiredAt?: number;
            retirementInvoiceId?: string;
            scopeKey: string;
            startedAt?: number;
            termsJson: string;
            viewJson?: string;
          },
          Name
        >;
        prepareCancellation: FunctionReference<
          "mutation",
          "internal",
          { cancelAtPeriodEnd: boolean; key: string; operationId: string },
          {
            _creationTime: number;
            _id: string;
            cancelAtPeriodEnd: boolean;
            firstAttemptAt: number;
            intentKey: string;
            key: string;
            operationId: string;
            resultJson?: string;
          },
          Name
        >;
        retire: FunctionReference<
          "mutation",
          "internal",
          { key: string; proofJson: string },
          null,
          Name
        >;
        save: FunctionReference<
          "mutation",
          "internal",
          { key: string; nativeJson: string; startedAt: number },
          null,
          Name
        >;
        saveInvoice: FunctionReference<
          "mutation",
          "internal",
          {
            invoiceId: string;
            key: string;
            observationsJson: string;
            startedAt: number;
          },
          null,
          Name
        >;
      };
      queries: {
        get: FunctionReference<
          "query",
          "internal",
          {
            requestId: string;
            scope: {
              customerAccount: string;
              livemode: boolean;
              stripeAccountId: string;
            };
          },
          {
            _creationTime: number;
            _id: string;
            abandonedId?: string;
            checkoutId?: string;
            controlKey?: string;
            firstAttemptAt: number;
            historyCount?: number;
            key: string;
            method: "direct" | "checkout";
            observationStartedAt?: number;
            providerId?: string;
            retiredAt?: number;
            retirementInvoiceId?: string;
            scopeKey: string;
            startedAt?: number;
            termsJson: string;
            viewJson?: string;
          } | null,
          Name
        >;
        history: FunctionReference<
          "query",
          "internal",
          {
            kind: "subscription" | "invoice" | "retirement";
            paginationOpts: {
              cursor: string | null;
              endCursor?: string | null;
              id?: number;
              maximumBytesRead?: number;
              maximumRowsRead?: number;
              numItems: number;
            };
            requestId: string;
            scope: {
              customerAccount: string;
              livemode: boolean;
              stripeAccountId: string;
            };
          },
          {
            continueCursor: string;
            isDone: boolean;
            page: Array<{
              _creationTime: number;
              _id: string;
              fingerprint: string;
              intentKey: string;
              kind: "subscription" | "invoice" | "retirement";
              observationJson: string;
              resourceId: string;
              startedAt: number;
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
          },
          Name
        >;
        lookup: FunctionReference<
          "query",
          "internal",
          { key: string },
          {
            _creationTime: number;
            _id: string;
            abandonedId?: string;
            checkoutId?: string;
            controlKey?: string;
            firstAttemptAt: number;
            historyCount?: number;
            key: string;
            method: "direct" | "checkout";
            observationStartedAt?: number;
            providerId?: string;
            retiredAt?: number;
            retirementInvoiceId?: string;
            scopeKey: string;
            startedAt?: number;
            termsJson: string;
            viewJson?: string;
          } | null,
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
