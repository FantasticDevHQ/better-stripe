import { renderCheckoutSession } from "./checkoutRequest.js";
import { submitPreparedCheckout } from "./preparedCheckout.js";
import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import type { StripeComponentCheckoutSession } from "../types.js";
import { componentRef } from "../webhooks/helpers.js";

export async function createCheckoutSession(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: Parameters<typeof renderCheckoutSession>[3],
) {
  const prepared = await renderCheckoutSession(stripe, component, ctx, opts);
  return submitPreparedCheckout(
    stripe,
    component,
    ctx,
    prepared,
    opts.idempotencyKey,
  );
}

export async function getCheckoutSession(
  component: Component,
  ctx: RunCtx,
  opts: { sessionId: string },
): Promise<StripeComponentCheckoutSession | null> {
  return (await ctx.runQuery(
    componentRef(component, "billing/queries/getCheckoutSession"),
    opts,
  )) as StripeComponentCheckoutSession | null;
}

export async function getCheckoutSessionByStripeId(
  component: Component,
  ctx: RunCtx,
  opts: { stripeSessionId: string },
): Promise<StripeComponentCheckoutSession | null> {
  return (await ctx.runQuery(
    componentRef(component, "billing/queries/getCheckoutSessionByStripeId"),
    opts,
  )) as StripeComponentCheckoutSession | null;
}

export async function listCheckoutSessionsByUser(
  component: Component,
  ctx: RunCtx,
  opts: { userId: string; status?: string },
): Promise<StripeComponentCheckoutSession[]> {
  return (await ctx.runQuery(
    componentRef(component, "billing/queries/listCheckoutSessionsByUser"),
    opts,
  )) as StripeComponentCheckoutSession[];
}

export async function upsertCheckoutSession(
  component: Component,
  ctx: RunCtx,
  opts: {
    stripeSessionId: string;
    userId: string;
    orgId?: string;
    accountId?: string;
    mode: "payment" | "subscription" | "setup";
    status: "open" | "complete" | "expired";
    clientSecret?: string;
    url?: string;
    priceId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await runMutationOrThrow(
    ctx,
    componentRef(component, "billing/mutations/upsertCheckoutSession"),
    opts,
  );
  return null;
}

export async function updateCheckoutSession(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: {
    stripeSessionId: string;
    metadata?: Record<string, string>;
  },
) {
  const session = await stripe.checkout.sessions.update(opts.stripeSessionId, {
    metadata: opts.metadata,
  });
  return session;
}
