import {
  reserveAffiliatePayout,
  completeAffiliatePayout,
  reconcileAffiliatePayout,
} from "../affiliateRecovery/payoutGate.js";
import { classifyRecoveryError } from "../affiliateRecovery/provider.js";
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

export type CreatePayoutOptions = {
  /** Host-authorized minimum in the payout currency. */
  minimumAmount?: number;
  stripeAccountId: string;
  amount: number;
  currency?: string;
  metadata?: Record<string, string>;
  /** Stripe idempotency key for retry-safe payout creation. */
  idempotencyKey?: string;
};

export async function createPayout(
  stripe: Stripe,
  ctx: RunCtx,
  opts: CreatePayoutOptions,
  component?: Component,
) {
  const release = component
    ? await reserveAffiliatePayout(component, ctx, opts)
    : null;
  if (release?.state === "submitted")
    return { stripePayoutId: release.stripePayoutId! };
  if (release?.state === "failed")
    throw new Error(
      "Affiliate payout failed; use a new authorized operation key.",
    );
  try {
    if (release) {
      const receiptId = await reconcileAffiliatePayout(stripe, release);
      if (receiptId) {
        await completeAffiliatePayout(
          component!,
          ctx,
          release.operationKey,
          "submitted",
          receiptId,
        );
        return { stripePayoutId: receiptId };
      }
    }
    if (release) {
      if (Date.now() - release.createdAt >= 23 * 60 * 60 * 1000)
        throw new Error(
          "Affiliate payout idempotency window expired; reconcile the provider receipt before retrying.",
        );
      // Receipt lookup may yield while a refund records new debt.
      await reserveAffiliatePayout(component!, ctx, opts);
    }
    const payout = await stripe.payouts.create(
      {
        amount: opts.amount,
        currency: opts.currency ?? "usd",
        metadata: release
          ? { ...opts.metadata, bsAffiliatePayout: release._id }
          : (opts.metadata ?? undefined),
      },
      {
        stripeAccount: opts.stripeAccountId,
        ...(opts.idempotencyKey !== undefined
          ? { idempotencyKey: opts.idempotencyKey }
          : {}),
      },
    );
    if (release)
      await completeAffiliatePayout(
        component!,
        ctx,
        release.operationKey,
        "submitted",
        payout.id,
      );
    return { stripePayoutId: payout.id };
  } catch (error) {
    if (release)
      await completeAffiliatePayout(
        component!,
        ctx,
        release.operationKey,
        classifyRecoveryError(error).state === "unknown" ? "unknown" : "failed",
      );
    throw error;
  }
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
