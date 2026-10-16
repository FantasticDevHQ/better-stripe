import { z } from "zod";
import type { RefundActor } from "./refundActor.js";

const accountId = z.string().regex(/^acct_[A-Za-z0-9_]+$/);
/** New observations require an explicit actor; legacy createRefund omission is not inherited. */
export const refundContextOptionsSchema = z
  .object({
    stripePaymentIntentId: z.string().regex(/^pi_[A-Za-z0-9_]+$/),
    actor: z.discriminatedUnion("type", [
      z.object({ type: z.literal("admin") }).strict(),
      z.object({ type: z.literal("seller"), accountId }).strict(),
    ]),
    stripeAccountId: accountId.optional(),
    maxRefundPages: z.number().int().min(1).max(10).default(5),
  })
  .strict();

export type RefundContextOptions = {
  stripePaymentIntentId: string;
  actor: RefundActor;
  /** Server-owned provider request scope, distinct from the buyer and merchant accounts. */
  stripeAccountId?: string;
  /** Complete bounded history or unavailable, never a partial refund balance. Default 5, maximum 10. */
  maxRefundPages?: number;
};
export type RefundContextUnavailableReason =
  | "payment_unavailable"
  | "buyer_unavailable"
  | "payment_scope_mismatch"
  | "payment_not_succeeded"
  | "charge_unavailable"
  | "charge_scope_mismatch"
  | "buyer_mismatch"
  | "currency_mismatch"
  | "amount_unavailable"
  | "charge_not_captured"
  | "charge_disputed"
  | "refund_pending"
  | "refund_state_unknown"
  | "refund_history_incomplete"
  | "refund_scope_mismatch"
  | "refund_counter_mismatch";
export type RefundContext =
  | { status: "unavailable"; reason: RefundContextUnavailableReason }
  | {
      status: "ready";
      stripePaymentIntentId: string;
      stripeChargeId: string;
      customerAccount: string;
      currency: string;
      capturedAmount: number;
      refundedAmount: number;
      remainingRefundableAmount: number;
      /** Milliseconds; an observation, not a reservation or immutable snapshot. */
      observedAt: number;
    };
