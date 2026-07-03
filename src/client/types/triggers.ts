import type {
  FunctionReference,
  FunctionReturnType,
  OptionalRestArgs,
} from "convex/server";

import type {
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
} from "./documents.js";

// ---------------------------------------------------------------------------
// Sync Triggers (run in same transaction as component DB write)
// ---------------------------------------------------------------------------

export interface SyncTriggers {
  account?: {
    onCreate?: (
      ctx: SyncTriggerCtx,
      doc: StripeComponentAccount,
    ) => Promise<void>;
    onUpdate?: (
      ctx: SyncTriggerCtx,
      newDoc: StripeComponentAccount,
      oldDoc: StripeComponentAccount,
    ) => Promise<void>;
  };
  subscription?: {
    onCreate?: (
      ctx: SyncTriggerCtx,
      doc: StripeComponentSubscription,
    ) => Promise<void>;
    onUpdate?: (
      ctx: SyncTriggerCtx,
      newDoc: StripeComponentSubscription,
      oldDoc: StripeComponentSubscription,
    ) => Promise<void>;
    onDelete?: (
      ctx: SyncTriggerCtx,
      doc: StripeComponentSubscription,
    ) => Promise<void>;
  };
  checkoutSession?: {
    onCompleted?: (
      ctx: SyncTriggerCtx,
      doc: StripeComponentCheckoutSession,
    ) => Promise<void>;
  };
  product?: {
    onCreate?: (
      ctx: SyncTriggerCtx,
      doc: StripeComponentProduct,
    ) => Promise<void>;
    onUpdate?: (
      ctx: SyncTriggerCtx,
      newDoc: StripeComponentProduct,
      oldDoc: StripeComponentProduct,
    ) => Promise<void>;
  };
  price?: {
    onCreate?: (
      ctx: SyncTriggerCtx,
      doc: StripeComponentPrice,
    ) => Promise<void>;
    onUpdate?: (
      ctx: SyncTriggerCtx,
      newDoc: StripeComponentPrice,
      oldDoc: StripeComponentPrice,
    ) => Promise<void>;
  };
  invoice?: {
    onCreate?: (
      ctx: SyncTriggerCtx,
      doc: StripeComponentInvoice,
    ) => Promise<void>;
    onUpdate?: (
      ctx: SyncTriggerCtx,
      newDoc: StripeComponentInvoice,
      oldDoc: StripeComponentInvoice,
    ) => Promise<void>;
  };
  payment?: {
    onCreate?: (
      ctx: SyncTriggerCtx,
      doc: StripeComponentPayment,
    ) => Promise<void>;
  };
  payout?: {
    onCreate?: (
      ctx: SyncTriggerCtx,
      doc: StripeComponentPayout,
    ) => Promise<void>;
    onUpdate?: (
      ctx: SyncTriggerCtx,
      newDoc: StripeComponentPayout,
      oldDoc: StripeComponentPayout,
    ) => Promise<void>;
  };
  refund?: {
    onCreate?: (
      ctx: SyncTriggerCtx,
      doc: StripeComponentRefund,
    ) => Promise<void>;
    onUpdate?: (
      ctx: SyncTriggerCtx,
      newDoc: StripeComponentRefund,
      oldDoc: StripeComponentRefund,
    ) => Promise<void>;
  };
  dispute?: {
    onCreate?: (
      ctx: SyncTriggerCtx,
      doc: StripeComponentDispute,
    ) => Promise<void>;
    onUpdate?: (
      ctx: SyncTriggerCtx,
      newDoc: StripeComponentDispute,
      oldDoc: StripeComponentDispute,
    ) => Promise<void>;
  };
}

/** Context passed to sync triggers — mutation-compatible (DB reads/writes only) */
export type SyncTriggerCtx = {
  runQuery: <Query extends FunctionReference<"query", "public" | "internal">>(
    query: Query,
    ...args: OptionalRestArgs<Query>
  ) => Promise<FunctionReturnType<Query>>;
  runMutation: <
    Mutation extends FunctionReference<"mutation", "public" | "internal">,
  >(
    mutation: Mutation,
    ...args: OptionalRestArgs<Mutation>
  ) => Promise<FunctionReturnType<Mutation>>;
};

// ---------------------------------------------------------------------------
// Async Hooks (run AFTER component DB write commits, separate transaction)
// ---------------------------------------------------------------------------

export interface AsyncHooks {
  onAccountUpdated?: (
    ctx: AsyncHookCtx,
    account: StripeComponentAccount,
  ) => Promise<void>;
  onCheckoutCompleted?: (
    ctx: AsyncHookCtx,
    session: StripeComponentCheckoutSession,
  ) => Promise<void>;
  onSubscriptionUpdated?: (
    ctx: AsyncHookCtx,
    subscription: StripeComponentSubscription,
  ) => Promise<void>;
  onSubscriptionCanceled?: (
    ctx: AsyncHookCtx,
    subscription: StripeComponentSubscription,
  ) => Promise<void>;
  onTrialEnding?: (
    ctx: AsyncHookCtx,
    subscription: StripeComponentSubscription,
  ) => Promise<void>;
  onInvoicePaid?: (
    ctx: AsyncHookCtx,
    invoice: StripeComponentInvoice,
  ) => Promise<void>;
  /**
   * A subscription invoice's charge failed (BTS-33). Fires on
   * `invoice.payment_failed` — the invoice-level (subscription-cycle) failure,
   * distinct from {@link onPaymentFailed} which is the one-time PaymentIntent
   * failure. The invoice carries `nextPaymentAttempt`/`attemptCount` so a
   * dunning email can say when Stripe's smart retries will try again.
   */
  onInvoicePaymentFailed?: (
    ctx: AsyncHookCtx,
    invoice: StripeComponentInvoice,
  ) => Promise<void>;
  onPaymentSucceeded?: (
    ctx: AsyncHookCtx,
    payment: StripeComponentPayment,
  ) => Promise<void>;
  onPaymentFailed?: (
    ctx: AsyncHookCtx,
    payment: StripeComponentPayment,
  ) => Promise<void>;
  onPayoutCompleted?: (
    ctx: AsyncHookCtx,
    payout: StripeComponentPayout,
  ) => Promise<void>;
  onRefundCreated?: (
    ctx: AsyncHookCtx,
    refund: StripeComponentRefund,
  ) => Promise<void>;
  onDisputeCreated?: (
    ctx: AsyncHookCtx,
    dispute: StripeComponentDispute,
  ) => Promise<void>;
  onDisputeClosed?: (
    ctx: AsyncHookCtx,
    dispute: StripeComponentDispute,
  ) => Promise<void>;
}

/** Context passed to async hooks — action-compatible (external API calls OK) */
export type AsyncHookCtx = {
  runQuery: <Query extends FunctionReference<"query", "public" | "internal">>(
    query: Query,
    ...args: OptionalRestArgs<Query>
  ) => Promise<FunctionReturnType<Query>>;
  runMutation: <
    Mutation extends FunctionReference<"mutation", "public" | "internal">,
  >(
    mutation: Mutation,
    ...args: OptionalRestArgs<Mutation>
  ) => Promise<FunctionReturnType<Mutation>>;
  runAction: <
    Action extends FunctionReference<"action", "public" | "internal">,
  >(
    action: Action,
    ...args: OptionalRestArgs<Action>
  ) => Promise<FunctionReturnType<Action>>;
};

// ---------------------------------------------------------------------------
// Webhook handler function references (passed to registerRoutes by the app)
// ---------------------------------------------------------------------------

/** Names of the upsert dispatchers routed through {@link WebhookHandlerRefs}. */
export type TriggerDispatcherName =
  | "accountUpserted"
  | "productUpserted"
  | "priceUpserted"
  | "subscriptionUpserted"
  | "subscriptionDeleted"
  | "checkoutSessionUpserted"
  | "invoiceUpserted"
  | "paymentUpserted"
  | "payoutUpserted"
  | "refundUpserted"
  | "disputeUpserted";

/** Names of the async hooks routed through {@link WebhookHandlerRefs}. */
export type AsyncHookName =
  | "afterAccountUpdated"
  | "afterCheckoutCompleted"
  | "afterSubscriptionUpdated"
  | "afterSubscriptionCanceled"
  | "afterTrialEnding"
  | "afterInvoicePaid"
  | "afterInvoicePaymentFailed"
  | "afterPaymentSucceeded"
  | "afterPaymentFailed"
  | "afterPayoutCompleted"
  | "afterRefundCreated"
  | "afterDisputeCreated"
  | "afterDisputeClosed";

/**
 * The two function refs produced by `stripe.webhookHandlers()`.
 *
 * The app exports the pair from a Convex module and passes that module to
 * `registerRoutes` as `webhooks: internal.stripe` (no cast needed). The
 * webhook handler routes every component upsert through `syncWebhook` (so the
 * configured sync trigger runs in the same transaction) and schedules every
 * async hook through `asyncWebhook` after commit. Each routes internally by a
 * discriminator arg (`dispatcher` / `hook`).
 */
export type WebhookHandlerRefs = {
  // Discriminators are typed `string` (not the narrower name unions) to match
  // what Convex codegen produces from `v.string()` args — so the app can pass
  // `webhooks: internal.stripe` without a cast. The library always passes a
  // valid TriggerDispatcherName/AsyncHookName at the call sites; the routing
  // tables throw on an unknown discriminator at runtime.
  syncWebhook: FunctionReference<
    "mutation",
    "internal",
    { dispatcher: string; data: Record<string, unknown> },
    null
  >;
  asyncWebhook: FunctionReference<
    "action",
    "internal",
    { hook: string; doc: Record<string, unknown> },
    null
  >;
};
