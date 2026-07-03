import type {
  StripeEventHandler,
  StripeEventHandlers,
  StripeWebhookEvent,
} from "./events.js";
import type {
  AsyncHooks,
  SyncTriggers,
  WebhookHandlerRefs,
} from "./triggers.js";

// ---------------------------------------------------------------------------
// Platform fee configuration (BTS-13)
// ---------------------------------------------------------------------------

/**
 * One band of a tiered fee schedule (Skool-style, e.g. 2.9% under $899 / 3.9%
 * above). `upTo` is the inclusive upper bound in minor units; the final tier
 * uses `upTo: null` as the catch-all. Tiers must be ascending and
 * non-overlapping.
 */
export type FeeTier = {
  upTo: number | null;
  percent: number;
  fixed?: number;
};

/**
 * The platform's take. `percent` (+ optional `fixed`) is the base; an optional
 * `tiers` schedule overrides by amount. The actual fee math lives in the
 * resolver (BTS-14); this is just the config shape.
 */
export type PlatformFeeConfig = {
  /** Base percentage (0–100). */
  percent: number;
  /** Optional fixed surcharge in minor units (e.g. 30 = 30¢). */
  fixed?: number;
  /** Optional tiered schedule; takes precedence over the base by amount. */
  tiers?: FeeTier[];
};

/**
 * Per-call fee override. Same shape as {@link PlatformFeeConfig}; takes
 * precedence over the global default. Resolution order:
 * per-call override → (per-product/seller, later) → global default.
 */
export type FeeOverride = PlatformFeeConfig;

// ---------------------------------------------------------------------------
// Client options
// ---------------------------------------------------------------------------

export type BetterStripeOptions = {
  STRIPE_SECRET_KEY?: string;
  /** Sync triggers — run in the same transaction as component DB writes */
  triggers?: SyncTriggers;
  /** Async hooks — run after component DB writes commit */
  hooks?: AsyncHooks;
  /** Default platform fee (the platform's take). Validated at construction. */
  platformFee?: PlatformFeeConfig;
  /**
   * Default statement-descriptor suffix applied to destination charges when
   * the seller account has no per-store suffix (BTS-32). Validated at
   * construction against Stripe's descriptor rules.
   */
  statementDescriptorSuffix?: string;
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
   * Function references to the app's exported `webhookHandlers()` pair,
   * e.g. `webhooks: internal.stripe` (no cast needed). When provided,
   * webhook upserts run through `syncWebhook` so sync triggers execute in the
   * same transaction as the component write, and async hooks are scheduled
   * through `asyncWebhook` after commit. When omitted, the handler falls back
   * to direct component upserts and skips async hooks.
   */
  webhooks?: WebhookHandlerRefs;
  /**
   * Cancel a subscription when its charge is disputed (Skool model). Default
   * `true`. The resulting `customer.subscription.updated`/`.deleted` webhook
   * fires your subscription trigger so the app can revoke access.
   */
  autoCancelOnDispute?: boolean;
  /**
   * When auto-canceling a disputed subscription, cancel immediately instead of
   * at period end. Default `false` (cancel at period end — access removed at the
   * end of the cycle, matching Skool).
   */
  cancelDisputedSubscriptionImmediately?: boolean;
};
