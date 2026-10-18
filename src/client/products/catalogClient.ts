import { UsageCatalogError } from "../usage/catalogTypes.js";
import * as usageCatalog from "../usage/catalog.js";
import * as usageLifecycle from "../usage/catalogLifecycle.js";
import { getUsagePriceBinding } from "../usage/catalogRead.js";
import type Stripe from "stripe";
import { BillingPortalClient } from "../core/billingPortalClient.js";
import type { RunCtx } from "../helpers.js";
import type { StripeComponentProduct, StripeComponentPrice } from "../types.js";
import * as productsImpl from "./products.js";
import * as pricesImpl from "./prices.js";
import * as catalog from "./catalog.js";

/** Catalog APIs inherited by BetterStripe. Host authorization remains required. */
export abstract class CatalogClient extends BillingPortalClient {
  abstract get statementDescriptorSuffix(): string | undefined;
  ensureUsageMeter(ctx: RunCtx, opts: usageCatalog.UsageMeterOptions) {
    return usageCatalog.ensureUsageMeter(
      this.stripe(),
      this.component,
      ctx,
      opts,
    );
  }
  async ensureUsagePrice(ctx: RunCtx, opts: usageCatalog.UsagePriceOptions) {
    await usageCatalog.ensureUsagePrice(
      this.stripe(),
      this.component,
      ctx,
      opts,
    );
    const binding = await getUsagePriceBinding(this.component, ctx, opts);
    if (binding.status !== "available")
      throw new UsageCatalogError(
        "provider_unavailable",
        "Native usage price mirror is unavailable",
      );
    return binding.value;
  }

  adoptUsageMeter(
    ctx: RunCtx,
    opts: usageCatalog.UsageMeterOptions & { meterId: string },
  ) {
    return usageLifecycle.adoptUsageMeter(
      this.stripe(),
      this.component,
      ctx,
      opts,
    );
  }
  getUsageMeterFromStripe(
    _ctx: RunCtx,
    opts: Parameters<typeof usageLifecycle.getUsageMeterFromStripe>[1],
  ) {
    return usageLifecycle.getUsageMeterFromStripe(this.stripe(), opts);
  }
  listStripeUsageMeters(
    _ctx: RunCtx,
    opts: Parameters<typeof usageLifecycle.listStripeUsageMeters>[1],
  ) {
    return usageLifecycle.listStripeUsageMeters(this.stripe(), opts);
  }
  deactivateUsageMeter(
    ctx: RunCtx,
    opts: { scope: usageCatalog.UsageCatalogScope; meterId: string },
  ) {
    return usageLifecycle.setUsageMeterActive(
      this.stripe(),
      this.component,
      ctx,
      { ...opts, active: false },
    );
  }
  reactivateUsageMeter(
    ctx: RunCtx,
    opts: { scope: usageCatalog.UsageCatalogScope; meterId: string },
  ) {
    return usageLifecycle.setUsageMeterActive(
      this.stripe(),
      this.component,
      ctx,
      { ...opts, active: true },
    );
  }
  getUsagePrice(ctx: RunCtx, opts: Parameters<typeof getUsagePriceBinding>[2]) {
    return getUsagePriceBinding(this.component, ctx, opts);
  }

  async getStripePriceByLookupKey(
    _ctx: RunCtx,
    opts: { lookupKey: string },
  ): Promise<Stripe.Price | null> {
    return catalog.getStripePriceByLookupKey(this.stripe(), opts);
  }
  async adoptProduct(ctx: RunCtx, opts: catalog.AdoptProductOptions) {
    return catalog.adoptProduct(this.stripe(), this.component, ctx, opts);
  }
  async ensurePrice(ctx: RunCtx, opts: catalog.EnsurePriceOptions) {
    return catalog.ensurePrice(this.stripe(), this.component, ctx, opts);
  }
  // PRODUCT METHODS

  async createProduct(ctx: RunCtx, opts: productsImpl.CreateProductOptions) {
    return productsImpl.createProduct(this.stripe(), this.component, ctx, {
      ...opts,
      // Stamp the per-store descriptor at create so it covers the first invoice
      // charge (BTS-67); resolves the store's suffix, else this default.
      defaultStatementDescriptorSuffix: this.statementDescriptorSuffix,
    });
  }

  async updateProduct(
    ctx: RunCtx,
    opts: {
      stripeProductId: string;
      name?: string;
      description?: string;
      active?: boolean;
      defaultPrice?: string | null;
      metadata?: Record<string, string>;
    },
  ) {
    return productsImpl.updateProduct(this.stripe(), this.component, ctx, {
      ...opts,
      defaultStatementDescriptorSuffix: this.statementDescriptorSuffix,
    });
  }

  async deactivateProduct(ctx: RunCtx, opts: { stripeProductId: string }) {
    return productsImpl.deactivateProduct(this.stripe(), ctx, opts);
  }

  async getProduct(
    ctx: RunCtx,
    opts: { productId: string },
  ): Promise<StripeComponentProduct | null> {
    return productsImpl.getProduct(this.component, ctx, opts);
  }

  async getProductByStripeId(
    ctx: RunCtx,
    opts: { stripeProductId: string },
  ): Promise<StripeComponentProduct | null> {
    return productsImpl.getProductByStripeId(this.component, ctx, opts);
  }

  async listProducts(
    ctx: RunCtx,
    opts?: { accountId?: string; active?: boolean; limit?: number },
  ): Promise<StripeComponentProduct[]> {
    return productsImpl.listProducts(this.component, ctx, opts);
  }

  async upsertProduct(
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
    return productsImpl.upsertProduct(this.component, ctx, opts);
  }

  async listStripeProducts(
    ctx: RunCtx,
    opts?: { active?: boolean; limit?: number },
  ): Promise<Stripe.Product[]> {
    return productsImpl.listStripeProducts(this.stripe(), ctx, opts);
  }

  async deleteProduct(
    ctx: RunCtx,
    opts: { stripeProductId: string },
  ): Promise<Stripe.Response<Stripe.DeletedProduct>> {
    return productsImpl.deleteProduct(this.stripe(), ctx, opts);
  }

  // PRICE METHODS

  async createPrice(ctx: RunCtx, opts: pricesImpl.CreatePriceOptions) {
    return pricesImpl.createPrice(this.stripe(), this.component, ctx, opts);
  }

  async updatePrice(
    ctx: RunCtx,
    opts: {
      stripePriceId: string;
      active?: boolean;
      nickname?: string;
      metadata?: Record<string, string>;
    },
  ) {
    return pricesImpl.updatePrice(this.stripe(), ctx, opts);
  }

  async deactivatePrice(ctx: RunCtx, opts: { stripePriceId: string }) {
    return pricesImpl.deactivatePrice(this.stripe(), ctx, opts);
  }

  async getPrice(
    ctx: RunCtx,
    opts: { priceId: string },
  ): Promise<StripeComponentPrice | null> {
    return pricesImpl.getPrice(this.component, ctx, opts);
  }

  async getPriceByStripeId(
    ctx: RunCtx,
    opts: { stripePriceId: string },
  ): Promise<StripeComponentPrice | null> {
    return pricesImpl.getPriceByStripeId(this.component, ctx, opts);
  }

  async listPrices(
    ctx: RunCtx,
    opts?: { productId?: string; active?: boolean; limit?: number },
  ): Promise<StripeComponentPrice[]> {
    return pricesImpl.listPrices(this.component, ctx, opts);
  }

  async listPricesByProduct(
    ctx: RunCtx,
    opts: { stripeProductId: string },
  ): Promise<StripeComponentPrice[]> {
    return pricesImpl.listPricesByProduct(this.component, ctx, opts);
  }

  async upsertPrice(
    ctx: RunCtx,
    opts: Parameters<typeof pricesImpl.upsertPrice>[2],
  ) {
    return pricesImpl.upsertPrice(this.component, ctx, opts);
  }

  async listStripePrices(
    ctx: RunCtx,
    opts?: { productId?: string; active?: boolean; limit?: number },
  ): Promise<Stripe.Price[]> {
    return pricesImpl.listStripePrices(this.stripe(), ctx, opts);
  }

  async syncAllProducts(ctx: RunCtx) {
    return productsImpl.syncAllProducts(this.stripe(), this.component, ctx);
  }
}
