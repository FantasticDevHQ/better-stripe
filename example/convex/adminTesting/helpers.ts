import { env } from "../_generated/server";
import type { getDemoAccounts } from "./queries";

/**
 * Real (test-mode) Stripe webhook triggers for the admin Testing page
 * (BTS-45).
 *
 * TEST-ONLY. Every action here makes a REAL Stripe test-mode API call — no
 * synthetic/mocked events — against the seeded marketplace demo personas
 * (Maya's store, Billie the buyer; run `npm run setup` first). Firing an
 * event only reaches the component ledger if `stripe listen --forward-to
 * <site>/stripe/webhook` is running locally (see README → "Browser E2E
 * Tests"), so each action polls the resulting component row for a few
 * seconds and reports whether the sync was actually observed — never a
 * canned success string.
 *
 * NOT unit-runnable end to end: the actions call live Stripe (test mode) and
 * depend on a linked dev deployment, same as `e2eMoney.ts`. Only the pure
 * `describeLedgerSync` helper is unit-tested (`adminTesting.test.ts`); the
 * actions are typecheck- + lint-covered.
 */
import Stripe from "stripe";

import { makeFunctionReference } from "convex/server";

import type { RegisteredQuery } from "convex/server";

import { type ActionCtx } from "../_generated/server";

import { assertTestModeStripeKey } from "../users/authorization";

import type { getMarketplaceDemoContext } from "../marketplace/queries";

// Re-exported for this file's own tests (adminTesting.test.ts) and any other
// caller that imported the guard from here before it moved to `./authz`
// (BTS-83, shared with issueRefund/reverseSaleTransfers/acceptDispute).
export { assertTestModeStripeKey };

// Match the API version the BetterStripe client pins (see seed.ts, e2eMoney.ts).
export type StripeApiVersion = NonNullable<
  NonNullable<ConstructorParameters<typeof Stripe>[1]>["apiVersion"]
>;

export const STRIPE_API_VERSION: StripeApiVersion = "2026-09-30.endive";

export function rawStripe(): Stripe {
  const key = env.STRIPE_SECRET_KEY;
  assertTestModeStripeKey(key);
  return new Stripe(key as string, { apiVersion: STRIPE_API_VERSION });
}

export const POLL_ATTEMPTS = 5;

export const POLL_INTERVAL_MS = 2_000;

export type QueryReturn<Query> =
  Query extends RegisteredQuery<
    "public" | "internal",
    Record<string, unknown>,
    infer Return
  >
    ? Awaited<Return>
    : never;

export type DemoAccounts = QueryReturn<typeof getDemoAccounts>;

export type MarketplaceDemoContext = QueryReturn<
  typeof getMarketplaceDemoContext
>;

export const getDemoAccountsRef = makeFunctionReference<
  "query",
  Record<string, never>,
  DemoAccounts
>("adminTesting/queries:getDemoAccounts");

export const getPaymentRowRef = makeFunctionReference<
  "query",
  { stripePaymentIntentId: string },
  unknown
>("e2eMoney/queries:getPaymentRow");

export const getMarketplaceDemoContextRef = makeFunctionReference<
  "query",
  Record<string, never>,
  MarketplaceDemoContext
>("marketplace/queries:getMarketplaceDemoContext");

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Formats whether the component ledger observed the event, and how long that took. */
export function describeLedgerSync(
  found: boolean,
  attempts: number,
  maxAttempts: number,
): string {
  if (found) {
    return `Synced to the component ledger after ${attempts}/${maxAttempts} poll${attempts === 1 ? "" : "s"}.`;
  }
  return (
    `Not yet synced after ${maxAttempts} polls — is ` +
    "`stripe listen --forward-to <site>/stripe/webhook` running? " +
    'See README → "Browser E2E Tests".'
  );
}

/** Poll `check` until it returns a truthy row, or give up. */
export async function pollForLedgerRow<T>(
  check: () => Promise<T | null | undefined>,
  matches: (row: T) => boolean = () => true,
): Promise<{ row: T | null; attempts: number }> {
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt++) {
    const row = await check();
    if (row && matches(row)) return { row, attempts: attempt };
    if (attempt < POLL_ATTEMPTS) await sleep(POLL_INTERVAL_MS);
  }
  return { row: null, attempts: POLL_ATTEMPTS };
}

export async function requireDemoAccounts(ctx: ActionCtx) {
  const accounts = await ctx.runQuery(getDemoAccountsRef, {});
  if (!accounts) {
    throw new Error(
      "Marketplace store/buyer not seeded — run `npm run setup` first.",
    );
  }
  return accounts;
}

// ─── Checkout Completed (one-time payment) ────────────────────────────────

export const ADMIN_TEST_PAYMENT_AMOUNT = 500;
