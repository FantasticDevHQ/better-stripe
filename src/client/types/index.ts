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
  StripeComponentInvoice,
  StripeComponentPayment,
  StripeComponentPayout,
  StripeComponentPrice,
  StripeComponentProduct,
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
  TriggerApiRefs,
  TriggerDispatchRef,
  AsyncHookRef,
} from "./triggers.js";
