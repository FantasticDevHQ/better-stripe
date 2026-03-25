import type {
  RegisterRoutesConfig,
  StripeWebhookEvent,
  WebhookActionCtx,
} from '../types.js';

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
