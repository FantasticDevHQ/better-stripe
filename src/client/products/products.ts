import type Stripe from 'stripe';

import type { Component, RunCtx } from '../helpers.js';
import { runMutationOrThrow } from '../helpers.js';
import type { StripeComponentProduct } from '../types.js';
import { componentRef } from '../webhooks/helpers.js';

// =============================================================================
// Product methods
// =============================================================================

export async function createProduct(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: {
    name: string;
    description?: string;
    active?: boolean;
    accountId?: string;
    metadata?: Record<string, string>;
  },
) {
  const product = await stripe.products.create({
    name: opts.name,
    description: opts.description ?? undefined,
    active: opts.active ?? true,
    metadata: opts.metadata ?? undefined,
  });

  await runMutationOrThrow(
    ctx,
    componentRef(component, 'products/mutations/upsertProduct'),
    {
      stripeProductId: product.id,
      accountId: opts.accountId,
      name: product.name,
      description: product.description ?? undefined,
      active: product.active,
      metadata: product.metadata ?? undefined,
    },
  );

  const stored = await ctx.runQuery(
    componentRef(component, 'products/queries/getProductByStripeId'),
    { stripeProductId: product.id },
  );

  return {
    productId: stored?._id ?? null,
    stripeProductId: product.id,
  };
}

export async function updateProduct(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: {
    stripeProductId: string;
    name?: string;
    description?: string;
    active?: boolean;
    defaultPrice?: string | null;
    metadata?: Record<string, string>;
  },
) {
  const updateParams: Stripe.ProductUpdateParams = {};
  if (opts.name !== undefined) updateParams.name = opts.name;
  if (opts.description !== undefined)
    updateParams.description = opts.description;
  if (opts.active !== undefined) updateParams.active = opts.active;
  if (opts.defaultPrice !== undefined) {
    updateParams.default_price = opts.defaultPrice ?? '';
  }
  if (opts.metadata !== undefined) updateParams.metadata = opts.metadata;
  await stripe.products.update(opts.stripeProductId, updateParams);
  return { success: true };
}

export async function deactivateProduct(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: { stripeProductId: string },
) {
  await stripe.products.update(opts.stripeProductId, { active: false });
  return { success: true };
}

export async function getProduct(
  component: Component,
  ctx: RunCtx,
  opts: { productId: string },
): Promise<StripeComponentProduct | null> {
  return (await ctx.runQuery(
    componentRef(component, 'products/queries/getProduct'),
    opts,
  )) as StripeComponentProduct | null;
}

export async function getProductByStripeId(
  component: Component,
  ctx: RunCtx,
  opts: { stripeProductId: string },
): Promise<StripeComponentProduct | null> {
  return (await ctx.runQuery(
    componentRef(component, 'products/queries/getProductByStripeId'),
    opts,
  )) as StripeComponentProduct | null;
}

export async function listProducts(
  component: Component,
  ctx: RunCtx,
  opts?: { accountId?: string; active?: boolean; limit?: number },
): Promise<StripeComponentProduct[]> {
  return (await ctx.runQuery(
    componentRef(component, 'products/queries/listProducts'),
    opts ?? {},
  )) as StripeComponentProduct[];
}

export async function upsertProduct(
  component: Component,
  ctx: RunCtx,
  opts: {
    stripeProductId: string;
    accountId?: string;
    name: string;
    description?: string;
    active: boolean;
    metadata?: Record<string, unknown>;
  },
) {
  await runMutationOrThrow(
    ctx,
    componentRef(component, 'products/mutations/upsertProduct'),
    opts,
  );
  return null;
}

export async function listStripeProducts(
  stripe: Stripe,
  _ctx: RunCtx,
  opts?: { active?: boolean; limit?: number },
) {
  const products: Stripe.Product[] = [];

  for await (const product of stripe.products.list({
    limit: opts?.limit ?? 100,
    active: opts?.active,
  })) {
    products.push(product);
  }

  return products;
}

export async function deleteProduct(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: { stripeProductId: string },
) {
  return await stripe.products.del(opts.stripeProductId);
}

// =============================================================================
// Sync
// =============================================================================

export async function syncAllProducts(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
) {
  let synced = 0;
  const errors: string[] = [];

  for await (const product of stripe.products.list({ limit: 100 })) {
    try {
      await runMutationOrThrow(
        ctx,
        componentRef(component, 'products/mutations/upsertProduct'),
        {
          stripeProductId: product.id,
          name: product.name,
          description: product.description ?? undefined,
          active: product.active,
          metadata: product.metadata ?? undefined,
        },
      );
      synced++;
    } catch (error) {
      errors.push(
        `Product ${product.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  let pricesSynced = 0;
  for await (const price of stripe.prices.list({ limit: 100 })) {
    try {
      const stripeProductId =
        typeof price.product === 'string' ? price.product : '';

      const internalProduct = await ctx.runQuery(
        componentRef(component, 'products/queries/getProductByStripeId'),
        { stripeProductId },
      );

      if (!internalProduct) {
        console.warn(
          `[better-stripe] Skipping price ${price.id}: product ${stripeProductId} not found in DB`,
        );
        continue;
      }

      await runMutationOrThrow(
        ctx,
        componentRef(component, 'products/mutations/upsertPrice'),
        {
          stripePriceId: price.id,
          productId: internalProduct._id,
          stripeProductId,
          nickname: price.nickname ?? undefined,
          unitAmount: price.unit_amount ?? 0,
          currency: price.currency,
          active: price.active,
          type: price.type,
          interval: price.recurring?.interval ?? undefined,
          intervalCount: price.recurring?.interval_count ?? undefined,
          metadata: price.metadata ?? undefined,
        },
      );
      pricesSynced++;
    } catch (error) {
      errors.push(
        `Price ${price.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  return {
    productsSynced: synced,
    pricesSynced,
    errors,
    errorCount: errors.length,
  };
}
