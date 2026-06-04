import type {
  StripeEventHandler,
  StripeEventHandlers,
  StripeWebhookEvent,
} from "./events.js";
import type { AsyncHooks, SyncTriggers } from "./triggers.js";

// ---------------------------------------------------------------------------
// Client options
// ---------------------------------------------------------------------------

export type BetterStripeOptions = {
  STRIPE_SECRET_KEY?: string;
  /** Sync triggers — run in the same transaction as component DB writes */
  triggers?: SyncTriggers;
  /** Async hooks — run after component DB writes commit */
  hooks?: AsyncHooks;
};

// ---------------------------------------------------------------------------
// Webhook registration
// ---------------------------------------------------------------------------

export type RegisterRoutesConfig = {
  webhookPath?: string;
  stripeSecretKey?: string;
  stripeApiVersion?: string;
  webhookSecret?: string;
  /** Separate signing secret for V2 thin event destinations. Falls back to webhookSecret. */
  webhookSecretV2?: string;
  onEvent?: StripeEventHandler<StripeWebhookEvent>;
  events?: StripeEventHandlers;
};
