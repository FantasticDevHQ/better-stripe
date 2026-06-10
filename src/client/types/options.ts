import type {
  StripeEventHandler,
  StripeEventHandlers,
  StripeWebhookEvent,
} from "./events.js";
import type { AsyncHooks, SyncTriggers, TriggerApiRefs } from "./triggers.js";

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
  /**
   * Function references to the app's exported `triggersApi()` wrappers.
   * When provided, webhook upserts run through these dispatchers so sync
   * triggers execute in the same transaction as the component write, and
   * async hooks are scheduled after commit.
   */
  triggers?: TriggerApiRefs;
};
