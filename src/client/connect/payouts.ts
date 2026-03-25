import type Stripe from 'stripe';

import type { Component, RunCtx } from '../helpers.js';
import { componentRef } from '../webhooks/helpers.js';

// =============================================================================
// Payout methods
// =============================================================================

export async function createPayout(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: {
    stripeAccountId: string;
    amount: number;
    currency?: string;
    metadata?: Record<string, string>;
  },
) {
  const payout = await stripe.payouts.create(
    {
      amount: opts.amount,
      currency: opts.currency ?? 'usd',
      metadata: opts.metadata ?? undefined,
    },
    { stripeAccount: opts.stripeAccountId },
  );
  return { stripePayoutId: payout.id };
}

export async function getPayout(
  component: Component,
  ctx: RunCtx,
  opts: { payoutId: string },
) {
  return ctx.runQuery(
    componentRef(component, 'connect/queries/getPayout'),
    opts,
  );
}

export async function listPayouts(
  component: Component,
  ctx: RunCtx,
  opts?: { accountId?: string; status?: string; limit?: number },
) {
  return ctx.runQuery(
    componentRef(component, 'connect/queries/listPayouts'),
    opts ?? {},
  );
}
