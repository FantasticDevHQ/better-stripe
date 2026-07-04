import type Stripe from "stripe";

import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { validateStatementDescriptorSuffix } from "../core/descriptors.js";
import type { StripeComponentProduct } from "../types.js";
import { componentRef } from "../webhooks/helpers.js";

// =============================================================================
// Product-level statement descriptor (BTS-67)
// =============================================================================

/**
 * Resolve the per-store statement descriptor to stamp on a Stripe Product, so
 * the store's descriptor covers the subscription's FIRST invoice charge —
 * the one the invoice-time `applyStatementDescriptor` path (BTS-32) can't reach,
 * because a `charge_automatically` sub finalizes + pays invoice #1 at creation,
 * before `invoice.created` fires. Per docs.stripe.com/connect/statement-descriptors
 * a subscription charge's descriptor precedence is Invoice → **Product** →
 * charge-type default, so a product-level descriptor covers every cycle
 * including the first, while the invoice-level path still wins when it applies.
 *
 * Per-store only: resolution mirrors the account-level suffix logic (BTS-32) —
 * the store's stored suffix, else the platform default. Products with no store
 * (`accountId`) are left untouched (no descriptor). Validation is reused and
 * defensive: an invalid resolved value is skipped (logged), never blocking the
 * product write, since the descriptor is cosmetic.
 */
async function resolveProductStatementDescriptor(
  component: Component,
  ctx: RunCtx,
  accountId: string | undefined,
  defaultSuffix: string | undefined,
): Promise<string | undefined> {
  if (!accountId) return undefined;
  const account = (await ctx.runQuery(
    componentRef(component, "core/queries/getAccountByStripeId"),
    { stripeAccountId: accountId },
  )) as { statementDescriptor?: string } | null;
  const resolved = account?.statementDescriptor ?? defaultSuffix;
  if (!resolved) return undefined;
  try {
    return validateStatementDescriptorSuffix(resolved);
  } catch {
    console.error(
      `[better-stripe] product statement_descriptor for ${accountId} is invalid; skipping`,
    );
    return undefined;
  }
}

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
    /** Platform default statement-descriptor suffix (BetterStripe option). */
    defaultStatementDescriptorSuffix?: string;
  },
) {
  const statementDescriptor = await resolveProductStatementDescriptor(
    component,
    ctx,
    opts.accountId,
    opts.defaultStatementDescriptorSuffix,
  );

  const product = await stripe.products.create({
    name: opts.name,
    description: opts.description ?? undefined,
    active: opts.active ?? true,
    metadata: opts.metadata ?? undefined,
    ...(statementDescriptor ? { statement_descriptor: statementDescriptor } : {}),
  });

  await runMutationOrThrow(
    ctx,
    componentRef(component, "products/mutations/upsertProduct"),
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
    componentRef(component, "products/queries/getProductByStripeId"),
    { stripeProductId: product.id },
  );

  return {
    productId: stored?._id ?? null,
    stripeProductId: product.id,
  };
}

export async function updateProduct(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: {
    stripeProductId: string;
    name?: string;
    description?: string;
    active?: boolean;
    defaultPrice?: string | null;
    metadata?: Record<string, string>;
    /** Platform default statement-descriptor suffix (BetterStripe option). */
    defaultStatementDescriptorSuffix?: string;
  },
) {
  const updateParams: Stripe.ProductUpdateParams = {};
  if (opts.name !== undefined) updateParams.name = opts.name;
  if (opts.description !== undefined)
    updateParams.description = opts.description;
  if (opts.active !== undefined) updateParams.active = opts.active;
  if (opts.defaultPrice !== undefined) {
    updateParams.default_price = opts.defaultPrice ?? "";
  }
  if (opts.metadata !== undefined) updateParams.metadata = opts.metadata;

  // Keep the product-level descriptor (BTS-67) fresh: resolve the owning store
  // from the stored product record so a store that set/changed its descriptor
  // propagates to its products' first-invoice charges. Re-set only when a value
  // resolves (never clears an existing descriptor).
  const stored = (await ctx.runQuery(
    componentRef(component, "products/queries/getProductByStripeId"),
    { stripeProductId: opts.stripeProductId },
  )) as { accountId?: string } | null;
  const statementDescriptor = await resolveProductStatementDescriptor(
    component,
    ctx,
    stored?.accountId,
    opts.defaultStatementDescriptorSuffix,
  );
  if (statementDescriptor) {
    updateParams.statement_descriptor = statementDescriptor;
  }

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
    componentRef(component, "products/queries/getProduct"),
    opts,
  )) as StripeComponentProduct | null;
}

export async function getProductByStripeId(
  component: Component,
  ctx: RunCtx,
  opts: { stripeProductId: string },
): Promise<StripeComponentProduct | null> {
  return (await ctx.runQuery(
    componentRef(component, "products/queries/getProductByStripeId"),
    opts,
  )) as StripeComponentProduct | null;
}

export async function listProducts(
  component: Component,
  ctx: RunCtx,
  opts?: { accountId?: string; active?: boolean; limit?: number },
): Promise<StripeComponentProduct[]> {
  return (await ctx.runQuery(
    componentRef(component, "products/queries/listProducts"),
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
    componentRef(component, "products/mutations/upsertProduct"),
    opts,
  );
  return null;
}

export async function listStripeProducts(
  stripe: Stripe,
  _ctx: RunCtx,
  opts?: { active?: boolean; limit?: number },
) {
  const limit = opts?.limit ?? 100;
  const products: Stripe.Product[] = [];

  // `for await` drives the SDK's auto-pagination, which walks every page
  // regardless of `limit` (that param only sets per-request page size) — break
  // once we've collected `limit` so this genuinely caps the result count.
  for await (const product of stripe.products.list({
    limit,
    active: opts?.active,
  })) {
    products.push(product);
    if (products.length >= limit) break;
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
        componentRef(component, "products/mutations/upsertProduct"),
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
        `Product ${product.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  let pricesSynced = 0;
  const productCache = new Map<string, { _id: string } | null>();
  for await (const price of stripe.prices.list({ limit: 100 })) {
    try {
      const stripeProductId =
        typeof price.product === "string" ? price.product : "";

      let internalProduct = productCache.get(stripeProductId);
      if (internalProduct === undefined) {
        internalProduct = (await ctx.runQuery(
          componentRef(component, "products/queries/getProductByStripeId"),
          { stripeProductId },
        )) as { _id: string } | null;
        productCache.set(stripeProductId, internalProduct);
      }

      if (!internalProduct) {
        console.warn(
          `[better-stripe] Skipping price ${price.id}: product ${stripeProductId} not found in DB`,
        );
        continue;
      }

      await runMutationOrThrow(
        ctx,
        componentRef(component, "products/mutations/upsertPrice"),
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
        `Price ${price.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
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
