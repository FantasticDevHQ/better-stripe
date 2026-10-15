import type { SplitRecipient } from "../../component/lib/fees.js";
import type { FeeOverride } from "../types.js";

/** Host-authorized Checkout Session request. */
export type CreateCheckoutSessionOptions = {
  idempotencyKey?: string;
  userId: string;
  orgId?: string;
  stripePriceId: string;
  mode: "payment" | "subscription" | "setup";
  uiMode?: "embedded" | "redirect" | "custom" | "form";
  quantity?: number;
  returnUrl: string;
  trialDays?: number;
  accountId?: string;
  customerEmail?: string;
  /** Seller/recipient connected account to route funds to (destination charge). */
  destinationAccountId?: string;
  /** Multiple recipients (store + affiliate[s]); >1 routes via separate charges & transfers. */
  split?: SplitRecipient[];
  /** Per-call platform fee override; falls back to the configured default. */
  fee?: FeeOverride;
  /** Charge total (minor units) for one-time payment fee computation. */
  amount?: number;
  metadata?: Record<string, string>;
  sessionOverrides?: Record<string, unknown>;
};
