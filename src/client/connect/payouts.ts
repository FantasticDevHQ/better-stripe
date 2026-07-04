import type Stripe from "stripe";

import type { PayoutStatus } from "../../component/connect/validators.js";
import type { Component, RunCtx } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";

// =============================================================================
// Payout methods
// =============================================================================

/**
 * A connected account's balance in one currency (minor units) — Stripe's
 * separate `available` / `pending` currency lists paired into a single entry.
 * Structurally the `RecipientBalance` the headless `PayoutSchedule` component
 * takes, so an element of `getAccountBalance`'s result feeds its `balance` prop
 * directly.
 */
export type AccountBalance = {
  /** Funds settled and ready for the next automatic payout. */
  available: number;
  /** Funds still settling. */
  pending: number;
  currency: string;
};

/**
 * Retrieve a connected account's balance (BTS-65), scoped to that account via
 * the `Stripe-Account` header (mirrors how the other per-account calls scope).
 * Stripe returns `available` and `pending` as separate per-currency lists; they
 * are paired here into one `AccountBalance` per currency (a currency present in
 * only one list gets 0 on the other side), preserving the order currencies
 * first appear across `available` then `pending`.
 */
export async function getAccountBalance(
  stripe: Stripe,
  opts: { stripeAccountId: string },
): Promise<AccountBalance[]> {
  const balance = await stripe.balance.retrieve(undefined, {
    stripeAccount: opts.stripeAccountId,
  });

  const byCurrency = new Map<string, AccountBalance>();
  const entryFor = (currency: string): AccountBalance => {
    let entry = byCurrency.get(currency);
    if (!entry) {
      entry = { available: 0, pending: 0, currency };
      byCurrency.set(currency, entry);
    }
    return entry;
  };
  for (const a of balance.available) entryFor(a.currency).available += a.amount;
  for (const p of balance.pending) entryFor(p.currency).pending += p.amount;
  return [...byCurrency.values()];
}

export async function createPayout(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: {
    stripeAccountId: string;
    amount: number;
    currency?: string;
    metadata?: Record<string, string>;
    /** Stripe idempotency key for retry-safe payout creation. */
    idempotencyKey?: string;
  },
) {
  const payout = await stripe.payouts.create(
    {
      amount: opts.amount,
      currency: opts.currency ?? "usd",
      metadata: opts.metadata ?? undefined,
    },
    {
      stripeAccount: opts.stripeAccountId,
      ...(opts.idempotencyKey !== undefined
        ? { idempotencyKey: opts.idempotencyKey }
        : {}),
    },
  );
  return { stripePayoutId: payout.id };
}

export async function getPayout(
  component: Component,
  ctx: RunCtx,
  opts: { payoutId: string },
) {
  return ctx.runQuery(
    componentRef(component, "connect/queries/getPayout"),
    opts,
  );
}

export async function listPayouts(
  component: Component,
  ctx: RunCtx,
  opts?: { stripeAccountId?: string; status?: PayoutStatus; limit?: number },
) {
  const { stripeAccountId, ...rest } = opts ?? {};
  return ctx.runQuery(componentRef(component, "connect/queries/listPayouts"), {
    ...rest,
    ...(stripeAccountId !== undefined ? { accountId: stripeAccountId } : {}),
  });
}
