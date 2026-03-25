import type Stripe from 'stripe';

import type { Component, RunCtx } from '../helpers.js';
import { runMutationOrThrow } from '../helpers.js';
import type { StripeComponentInvoice } from '../types.js';
import { componentRef } from '../webhooks/helpers.js';

// =============================================================================
// Invoice methods
// =============================================================================

export async function listInvoices(
  component: Component,
  ctx: RunCtx,
  opts?: {
    userId?: string;
    subscriptionId?: string;
    status?: string;
    limit?: number;
  },
): Promise<StripeComponentInvoice[]> {
  return (await ctx.runQuery(
    componentRef(component, 'billing/queries/listInvoices'),
    opts ?? {},
  )) as StripeComponentInvoice[];
}

export async function listInvoicesByUser(
  component: Component,
  ctx: RunCtx,
  opts: { userId: string },
) {
  return (await ctx.runQuery(
    componentRef(component, 'billing/queries/listInvoices'),
    {
      userId: opts.userId,
    },
  )) as StripeComponentInvoice[];
}

export async function upsertInvoice(
  component: Component,
  ctx: RunCtx,
  opts: {
    stripeInvoiceId: string;
    userId: string;
    orgId?: string;
    accountId?: string;
    subscriptionId?: string;
    status: string;
    currency: string;
    amountDue: number;
    amountPaid: number;
    hostedInvoiceUrl?: string;
    invoicePdf?: string;
    periodStart?: string;
    periodEnd?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await runMutationOrThrow(
    ctx,
    componentRef(component, 'billing/mutations/upsertInvoice'),
    opts,
  );
  return null;
}

export async function getInvoiceFromStripe(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: { stripeInvoiceId: string },
) {
  const invoice = await stripe.invoices.retrieve(opts.stripeInvoiceId);
  return invoice;
}
