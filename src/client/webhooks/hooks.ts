import type {
  RegisterRoutesConfig,
  StripeWebhookEvent,
  WebhookActionCtx,
} from "../types.js";
import type { AsyncHookName } from "../types/triggers.js";
import { type WebhookContext, componentRef } from "./helpers.js";

// =============================================================================
// HOOK RUNNER
// =============================================================================

export async function runHooks(
  ctx: WebhookActionCtx,
  config: RegisterRoutesConfig | undefined,
  event: StripeWebhookEvent,
): Promise<void> {
  if (config?.onEvent) {
    try {
      await config.onEvent(ctx, event);
    } catch (error) {
      console.error(
        `[better-stripe] onEvent hook error for ${event.type}:`,
        error,
      );
    }
  }

  const handler = config?.events?.[event.type];
  if (handler) {
    try {
      await handler(ctx, event);
    } catch (error) {
      console.error(
        `[better-stripe] Event hook error for ${event.type}:`,
        error,
      );
    }
  }
}

// =============================================================================
// ASYNC HOOK SCHEDULER
// =============================================================================

type HookSpec = {
  hook: AsyncHookName;
  /** Component query path used to fetch the committed doc. */
  getter: string;
  /** Argument name the getter expects the Stripe object id under. */
  idArg: string;
};

/** V1 event type → async hook + component query to fetch the committed doc. */
const HOOK_EVENT_MAP: Record<string, HookSpec> = {
  "checkout.session.completed": {
    hook: "afterCheckoutCompleted",
    getter: "billing/queries/getCheckoutSessionByStripeId",
    idArg: "stripeSessionId",
  },
  "customer.subscription.created": {
    hook: "afterSubscriptionUpdated",
    getter: "billing/queries/getSubscriptionByStripeId",
    idArg: "stripeSubscriptionId",
  },
  "customer.subscription.updated": {
    hook: "afterSubscriptionUpdated",
    getter: "billing/queries/getSubscriptionByStripeId",
    idArg: "stripeSubscriptionId",
  },
  "customer.subscription.deleted": {
    hook: "afterSubscriptionCanceled",
    getter: "billing/queries/getSubscriptionByStripeId",
    idArg: "stripeSubscriptionId",
  },
  "customer.subscription.trial_will_end": {
    hook: "afterTrialEnding",
    getter: "billing/queries/getSubscriptionByStripeId",
    idArg: "stripeSubscriptionId",
  },
  "invoice.paid": {
    hook: "afterInvoicePaid",
    getter: "billing/queries/getInvoiceByStripeId",
    idArg: "stripeInvoiceId",
  },
  "payment_intent.succeeded": {
    hook: "afterPaymentSucceeded",
    getter: "connect/queries/getPaymentByStripeId",
    idArg: "stripePaymentIntentId",
  },
  "payment_intent.payment_failed": {
    hook: "afterPaymentFailed",
    getter: "connect/queries/getPaymentByStripeId",
    idArg: "stripePaymentIntentId",
  },
  "payout.paid": {
    hook: "afterPayoutCompleted",
    getter: "connect/queries/getPayoutByStripeId",
    idArg: "stripePayoutId",
  },
  "refund.created": {
    hook: "afterRefundCreated",
    getter: "connect/queries/getRefundByStripeId",
    idArg: "stripeRefundId",
  },
  "charge.dispute.created": {
    hook: "afterDisputeCreated",
    getter: "connect/queries/getDisputeByStripeId",
    idArg: "stripeDisputeId",
  },
  "charge.dispute.closed": {
    hook: "afterDisputeClosed",
    getter: "connect/queries/getDisputeByStripeId",
    idArg: "stripeDisputeId",
  },
};

/**
 * All `v2.core.account*` events (account, account_person, account_link)
 * resolve to the connected account, so they all schedule afterAccountUpdated.
 */
const V2_ACCOUNT_HOOK: HookSpec = {
  hook: "afterAccountUpdated",
  getter: "core/queries/getAccountByStripeId",
  idArg: "stripeAccountId",
};

/**
 * Schedule the app's async hook for this event, if configured.
 * Each event maps to at most one hook, so at most one function is scheduled.
 * Runs after the component write committed and the ledger row is marked
 * processed — failures are logged, never thrown.
 */
export async function scheduleAsyncHook(
  whCtx: WebhookContext,
  eventType: string,
  stripeObjectId: string | null | undefined,
): Promise<void> {
  const spec = eventType.startsWith("v2.core.account")
    ? V2_ACCOUNT_HOOK
    : HOOK_EVENT_MAP[eventType];
  if (!spec || !stripeObjectId) return;

  const refs = whCtx.config?.webhooks;
  if (!refs) return;

  const scheduler = whCtx.ctx.scheduler;
  if (!scheduler) {
    console.warn(
      `[better-stripe] Async hook ${spec.hook} configured but ctx.scheduler unavailable — hook skipped`,
    );
    return;
  }

  try {
    const doc = (await whCtx.ctx.runQuery(
      componentRef(whCtx.component, spec.getter),
      { [spec.idArg]: stripeObjectId },
    )) as Record<string, unknown> | null;
    if (doc) {
      await scheduler.runAfter(0, refs.asyncWebhook, { hook: spec.hook, doc });
    }
  } catch (error) {
    console.error(
      `[better-stripe] Failed to schedule async hook for ${eventType}:`,
      error,
    );
  }
}
