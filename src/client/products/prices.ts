import type Stripe from "stripe";

import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { throwStripeError } from "../errors.js";
import type { StripeComponentPrice } from "../types.js";
import { componentRef } from "../webhooks/helpers.js";

// =============================================================================
// Price methods
// =============================================================================

export async function createPrice(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: {
    stripeProductId: string;
    unitAmount: number;
    currency?: string;
    type: "one_time" | "recurring";
    interval?: "day" | "week" | "month" | "year";
    intervalCount?: number;
    nickname?: string;
    metadata?: Record<string, string>;
  },
) {
  const priceParams: Stripe.PriceCreateParams = {
    product: opts.stripeProductId,
    unit_amount: opts.unitAmount,
    currency: opts.currency ?? "usd",
    nickname: opts.nickname ?? undefined,
    metadata: opts.metadata ?? undefined,
  };

  if (opts.type === "recurring" && opts.interval) {
    priceParams.recurring = {
      interval: opts.interval,
      interval_count: opts.intervalCount ?? 1,
    };
  }

  const price = await stripe.prices.create(priceParams);

  const internalProduct = await ctx.runQuery(
    componentRef(component, "products/queries/getProductByStripeId"),
    { stripeProductId: opts.stripeProductId },
  );
  if (!internalProduct) {
    throwStripeError("PRODUCT_NOT_FOUND", `Product ${opts.stripeProductId} not found in component DB when creating price`);
  }

  await runMutationOrThrow(
    ctx,
    componentRef(component, "products/mutations/upsertPrice"),
    {
      stripePriceId: price.id,
      productId: internalProduct._id,
      stripeProductId: opts.stripeProductId,
      nickname: price.nickname ?? undefined,
      unitAmount: price.unit_amount ?? 0,
      currency: price.currency,
      active: price.active,
      type: opts.type,
      interval: opts.interval,
      intervalCount: opts.intervalCount,
      metadata: price.metadata ?? undefined,
    },
  );

  return { stripePriceId: price.id };
}

export async function updatePrice(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: {
    stripePriceId: string;
    active?: boolean;
    nickname?: string;
    metadata?: Record<string, string>;
  },
) {
  const updateParams: Stripe.PriceUpdateParams = {};
  if (opts.active !== undefined) updateParams.active = opts.active;
  if (opts.nickname !== undefined) updateParams.nickname = opts.nickname;
  if (opts.metadata !== undefined) updateParams.metadata = opts.metadata;
  await stripe.prices.update(opts.stripePriceId, updateParams);
  return { success: true };
}

export async function deactivatePrice(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: { stripePriceId: string },
) {
  await stripe.prices.update(opts.stripePriceId, { active: false });
  return { success: true };
}

export async function getPrice(
  component: Component,
  ctx: RunCtx,
  opts: { priceId: string },
): Promise<StripeComponentPrice | null> {
  return (await ctx.runQuery(
    componentRef(component, "products/queries/getPrice"),
    opts,
  )) as StripeComponentPrice | null;
}

export async function getPriceByStripeId(
  component: Component,
  ctx: RunCtx,
  opts: { stripePriceId: string },
): Promise<StripeComponentPrice | null> {
  return (await ctx.runQuery(
    componentRef(component, "products/queries/getPriceByStripeId"),
    opts,
  )) as StripeComponentPrice | null;
}

export async function listPrices(
  component: Component,
  ctx: RunCtx,
  opts?: { productId?: string; active?: boolean; limit?: number },
): Promise<StripeComponentPrice[]> {
  return (await ctx.runQuery(
    componentRef(component, "products/queries/listPrices"),
    opts ?? {},
  )) as StripeComponentPrice[];
}

export async function listPricesByProduct(
  component: Component,
  ctx: RunCtx,
  opts: { stripeProductId: string },
): Promise<StripeComponentPrice[]> {
  return (await ctx.runQuery(
    componentRef(component, "products/queries/listPricesByProduct"),
    opts,
  )) as StripeComponentPrice[];
}

export async function upsertPrice(
  component: Component,
  ctx: RunCtx,
  opts: {
    stripePriceId: string;
    productId: string;
    stripeProductId: string;
    nickname?: string;
    unitAmount: number;
    currency: string;
    active: boolean;
    type: "one_time" | "recurring";
    interval?: "day" | "week" | "month" | "year";
    intervalCount?: number;
    metadata?: Record<string, unknown>;
  },
) {
  await runMutationOrThrow(
    ctx,
    componentRef(component, "products/mutations/upsertPrice"),
    opts,
  );
  return null;
}

export async function listStripePrices(
  stripe: Stripe,
  _ctx: RunCtx,
  opts?: { productId?: string; active?: boolean; limit?: number },
) {
  const prices: Stripe.Price[] = [];

  for await (const price of stripe.prices.list({
    limit: opts?.limit ?? 100,
    product: opts?.productId,
    active: opts?.active,
  } as Stripe.PriceListParams)) {
    prices.push(price);
  }

  return prices;
}
