import { type Mock, vi } from "vitest";
import type { WebhookActionCtx } from "../../src/client/types.js";

/** Current-source/receipt fixture for the retained route projection assertion. */
export function mockQualifiedRefund(
  ctx: WebhookActionCtx,
  retrieve: Mock,
  original: Record<string, unknown>,
) {
  const refund = {
    stripeRefundId: "re_123",
    stripePaymentIntentId: "pi_abc",
    stripeChargeId: "ch_xyz",
    amount: 500,
    currency: "usd",
    status: "succeeded",
    reason: "requested_by_customer",
  };
  retrieve.mockResolvedValue({ ...original, object: "refund" });
  vi.mocked(ctx.runQuery)
    .mockResolvedValueOnce({
      status: "unknown",
      merchantAccount: null,
      requiresChargeProof: false,
    })
    .mockResolvedValue([]);
  vi.mocked(ctx.runMutation)
    .mockResolvedValueOnce("inserted")
    .mockResolvedValueOnce(1)
    .mockResolvedValueOnce({
      status: "accepted",
      generation: 1,
      changed: true,
      refund: { _id: "component_refund", _creationTime: 0, ...refund },
    });
  return refund;
}
