import type {
  FunctionReference,
  FunctionReturnType,
  OptionalRestArgs,
} from "convex/server";

import type {
  StripeComponentAccount,
  StripeComponentCheckoutSession,
  StripeComponentInvoice,
  StripeComponentPayment,
  StripeComponentPayout,
  StripeComponentPrice,
  StripeComponentProduct,
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
// Trigger API function references (passed to registerRoutes by the app)
// ---------------------------------------------------------------------------

/** Internal mutation that upserts a component doc and runs the sync trigger. */
export type TriggerDispatchRef = FunctionReference<
  "mutation",
  "internal",
  { data: Record<string, unknown> },
  null
>;

/** Names of the upsert dispatcher refs in {@link TriggerApiRefs}. */
export type TriggerDispatcherName =
  | "accountUpserted"
  | "productUpserted"
  | "priceUpserted"
  | "subscriptionUpserted"
  | "subscriptionDeleted"
  | "checkoutSessionUpserted"
  | "invoiceUpserted"
  | "paymentUpserted"
  | "payoutUpserted";

/** Names of the async hook refs in {@link TriggerApiRefs}. */
export type AsyncHookName =
  | "afterAccountUpdated"
  | "afterCheckoutCompleted"
  | "afterSubscriptionUpdated"
  | "afterSubscriptionCanceled"
  | "afterTrialEnding"
  | "afterInvoicePaid"
  | "afterPaymentSucceeded"
  | "afterPaymentFailed"
  | "afterPayoutCompleted";

/** Internal action that runs an async hook with the committed doc. */
export type AsyncHookRef = FunctionReference<
  "action",
  "internal",
  { doc: Record<string, unknown> },
  null
>;

/**
 * Function references to the wrappers returned by `triggersApi()`.
 * The app exports them from a Convex module and passes that module here:
 * `triggers: internal.stripe` (no cast needed).
 * All fields optional — the handler falls back to direct component
 * upserts for any dispatcher that is missing.
 */
export type TriggerApiRefs = Partial<{
  accountUpserted: TriggerDispatchRef;
  productUpserted: TriggerDispatchRef;
  priceUpserted: TriggerDispatchRef;
  subscriptionUpserted: TriggerDispatchRef;
  subscriptionDeleted: TriggerDispatchRef;
  checkoutSessionUpserted: TriggerDispatchRef;
  invoiceUpserted: TriggerDispatchRef;
  paymentUpserted: TriggerDispatchRef;
  payoutUpserted: TriggerDispatchRef;
  afterAccountUpdated: AsyncHookRef;
  afterCheckoutCompleted: AsyncHookRef;
  afterSubscriptionUpdated: AsyncHookRef;
  afterSubscriptionCanceled: AsyncHookRef;
  afterTrialEnding: AsyncHookRef;
  afterInvoicePaid: AsyncHookRef;
  afterPaymentSucceeded: AsyncHookRef;
  afterPaymentFailed: AsyncHookRef;
  afterPayoutCompleted: AsyncHookRef;
}>;
