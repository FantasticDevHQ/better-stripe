import type Stripe from "stripe";
import { refundObjectId } from "./refundTarget.js";
import type { RefundContextUnavailableReason } from "./refundContextTypes.js";

type HistoryResult =
  | { status: "complete"; refundedAmount: number }
  | { status: "unavailable"; reason: RefundContextUnavailableReason };
const unavailable = (
  reason: RefundContextUnavailableReason,
): HistoryResult => ({ status: "unavailable", reason });

/** All bounded pages must agree with the captured charge; loaded previews cannot establish a remainder. */
export async function readRefundHistory(
  stripe: Stripe,
  opts: {
    paymentIntentId: string;
    chargeId: string;
    currency: string;
    capturedAmount: number;
    maxRefundPages: number;
    stripeAccountId?: string;
  },
): Promise<HistoryResult> {
  let refundedAmount = 0;
  let cursor: string | undefined;
  const seen = new Set<string>();
  for (let count = 0; count < opts.maxRefundPages; count++) {
    const page = await stripe.refunds.list(
      {
        payment_intent: opts.paymentIntentId,
        limit: 100,
        ...(cursor ? { starting_after: cursor } : {}),
      },
      opts.stripeAccountId
        ? { stripeAccount: opts.stripeAccountId }
        : undefined,
    );
    if (
      !page ||
      page.object !== "list" ||
      !Array.isArray(page.data) ||
      page.data.length > 100 ||
      typeof page.has_more !== "boolean" ||
      (page.has_more && !page.data.length)
    )
      return unavailable("refund_history_incomplete");
    for (const refund of page.data) {
      if (
        !refund ||
        refund.object !== "refund" ||
        typeof refund.id !== "string" ||
        !/^re_[A-Za-z0-9_]+$/.test(refund.id) ||
        seen.has(refund.id)
      )
        return unavailable("refund_history_incomplete");
      seen.add(refund.id);
      if (
        refundObjectId(refund.charge) !== opts.chargeId ||
        refundObjectId(refund.payment_intent) !== opts.paymentIntentId ||
        refund.currency !== opts.currency ||
        !Number.isSafeInteger(refund.amount) ||
        refund.amount < 0
      )
        return unavailable("refund_scope_mismatch");
      if (refund.status === "pending" || refund.status === "requires_action")
        return unavailable("refund_pending");
      if (
        refund.status !== "succeeded" &&
        refund.status !== "failed" &&
        refund.status !== "canceled"
      )
        return unavailable("refund_state_unknown");
      if (refund.status === "succeeded") refundedAmount += refund.amount;
      if (
        !Number.isSafeInteger(refundedAmount) ||
        refundedAmount > opts.capturedAmount
      )
        return unavailable("refund_counter_mismatch");
    }
    if (!page.has_more) return { status: "complete", refundedAmount };
    cursor = page.data[page.data.length - 1]!.id;
  }
  return unavailable("refund_history_incomplete");
}
