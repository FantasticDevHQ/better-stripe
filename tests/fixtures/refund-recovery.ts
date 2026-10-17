import type Stripe from "stripe";
import { vi } from "vitest";
import type { WebhookContext } from "../../src/client/webhooks/helpers.js";
import { processEvent } from "../../src/client/webhooks/processors.js";

// Isolate the retained recovery math; refund-delivery.test.ts covers current
// qualification over the real public SDK, host/component and HTTP transport.
export function processRefund(
  whCtx: WebhookContext,
  notification: Stripe.Event,
) {
  const current = {
    ...(notification.data.object as Stripe.Refund),
    reason: (notification.data.object as Stripe.Refund).reason ?? null,
    object: "refund" as const,
  };
  vi.mocked(whCtx.stripe.refunds.retrieve).mockResolvedValue(
    current as Stripe.Response<Stripe.Refund>,
  );
  vi.mocked(whCtx.ctx.runQuery).mockResolvedValueOnce({
    status: "ready",
    requiresChargeProof: false,
  });
  vi.mocked(whCtx.ctx.runMutation).mockResolvedValueOnce(1 as never);
  vi.mocked(whCtx.ctx.runMutation).mockResolvedValueOnce({
    status: "accepted",
    generation: 1,
    changed: true,
    refund: {
      stripeRefundId: current.id,
      stripePaymentIntentId: current.payment_intent,
      stripeChargeId: current.charge,
      amount: current.amount,
      currency: current.currency,
      status: current.status,
    },
  } as never);
  return processEvent(whCtx, notification);
}
