// Barrel re-export — preserves the exact public API of the old types.ts
export type { BetterStripeOptions, RegisterRoutesConfig } from "./options.js";

export type {
  StripeWebhookEvent,
  StripeEventHandler,
  StripeEventHandlers,
  WebhookActionCtx,
  V2ThinEvent,
} from "./events.js";

export type {
  AccountLinkWithStatus,
  PaymentMethodCard,
  PaymentMethodLike,
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
  StripeComponentWebhookEvent,
  StripeCountrySpecs,
  StripeV2Account,
} from "./documents.js";

export type {
  SyncTriggers,
  SyncTriggerCtx,
  AsyncHooks,
  AsyncHookCtx,
  WebhookHandlerRefs,
} from "./triggers.js";
