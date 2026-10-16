import { env } from "../_generated/server";

/**
 * Money-scenario drivers + ledger reads for the e2e:webhooks release gate
 * (BTS-49).
 *
 * The webhook harness (`scripts/e2e-webhooks.ts`) proves events flow through the
 * pipeline; these functions let it prove the MONEY actually moves — a
 * destination charge collects an `application_fee`, a multi-recipient split
 * fans out one `Transfer` per recipient, and a refund/dispute reverses them.
 * All the driving happens through real Stripe API calls + the real webhook
 * engine; the harness then reads these queries to assert the persisted ledger.
 *
 * NOT unit-runnable end to end: the actions call live Stripe (test mode) and
 * depend on a linked dev deployment. Only the pure helpers are unit-tested
 * (`e2e-money.test.ts`); the actions/queries are typecheck- + lint-covered and
 * exercised by the pre-release `pnpm --filter ./example run e2e:webhooks` run.
 */

import Stripe from "stripe";

import { components } from "../_generated/api";

// Match the API version the BetterStripe client pins (see seed.ts).
export type StripeApiVersion = NonNullable<
  NonNullable<ConstructorParameters<typeof Stripe>[1]>["apiVersion"]
>;

export const STRIPE_API_VERSION: StripeApiVersion = "2026-09-30.endive";

export function rawStripe(): Stripe {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set on the deployment");
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION });
}

export const connectQueries = components.betterStripe.connect.queries;

// ─── Pure reconciliation helper (unit-tested) ────────────────────────────

/**
 * The headline invariant: a marketplace sale reconciles when the recipients'
 * cuts plus the platform's share equal the charge. Given the charge amount and
 * the recipient legs, the platform share is the remainder — non-negative and
 * exact — iff the sale reconciles.
 */
export function reconcilesToCharge(
  chargeAmount: number,
  recipientAmounts: number[],
): boolean {
  const recipientsTotal = recipientAmounts.reduce((sum, a) => sum + a, 0);
  const platform = chargeAmount - recipientsTotal;
  return (
    platform >= 0 && recipientsTotal >= 0 && recipientsTotal <= chargeAmount
  );
}

// ─── Scenario drivers ────────────────────────────────────────────────────

export const DEMO_CURRENCY = "usd";

// ─── BTS-66: per-charge-fee (BTS-60) sale + capped full-refund reversal ──

/**
 * The expected post-refund transfer state for a FULL refund (default
 * `reverse_transfer: true`) of a destination charge whose transfer was already
 * partially reversed by the BTS-60 fee collection (`bs_pcfee_<pi.id>`).
 *
 * Live-verified (BTS-66, Stripe test mode, 2026-07-03): Stripe does NOT error
 * when the proportional reversal would exceed what remains reversible — it
 * CAPS the refund-driven reversal at the remainder, leaving the transfer
 * exactly fully reversed (fee reversal + capped refund reversal).
 */
export function fullRefundReversalPlan(
  transferAmount: number,
  alreadyReversed: number,
): { refundReversal: number; totalReversed: number } {
  return {
    refundReversal: transferAmount - alreadyReversed,
    totalReversed: transferAmount,
  };
}
