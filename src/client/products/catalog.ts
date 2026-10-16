import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { throwStripeError } from "../errors.js";
import { getChargeCurrencyMetadata } from "../charge-currency.js";
import { componentRef } from "../webhooks/helpers.js";
import type { CreatePriceOptions } from "./prices.js";

export type AdoptProductOptions = {
  stripeProductId: string;
  accountId?: string;
};
/** Host authorizes catalog scope. Reuse this key only for identical creation parameters. */
export type EnsurePriceOptions = CreatePriceOptions & {
  lookupKey: string;
  idempotencyKey: string;
};

function validateLookupKey(key: string) {
  if (!key.trim() || key.length > 200)
    throwStripeError(
      "INVALID_CONFIGURATION",
      "lookupKey must contain 1–200 characters",
    );
}

/** Provider lookup includes inactive prices so ensure never steals an archived key. */
export async function getStripePriceByLookupKey(
  stripe: Stripe,
  opts: { lookupKey: string },
): Promise<Stripe.Price | null> {
  validateLookupKey(opts.lookupKey);
  const page = await stripe.prices.list({
    lookup_keys: [opts.lookupKey],
    limit: 2,
  });
  if (page.has_more || page.data.length > 1)
    throwStripeError("INVALID_CONFIGURATION", "Ambiguous price lookup key");
  return page.data[0] ?? null;
}

/** Imports provider data; caller must authorize the product and optional owning account. */
export async function adoptProduct(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: AdoptProductOptions,
) {
  const product = await stripe.products.retrieve(opts.stripeProductId);
  if ("deleted" in product || product.id !== opts.stripeProductId)
    throwStripeError(
      "PRODUCT_NOT_FOUND",
      "Product is deleted or does not match requested identity",
    );
  const stored = await ctx.runQuery(
    componentRef(component, "products/queries/getProductByStripeId"),
    { stripeProductId: opts.stripeProductId },
  );
  if (
    stored?.accountId &&
    opts.accountId !== undefined &&
    stored.accountId !== opts.accountId
  )
    throwStripeError(
      "INVALID_CONFIGURATION",
      "Product ownership cannot be reassigned by adoption",
    );
  await runMutationOrThrow(
    ctx,
    componentRef(component, "products/mutations/upsertProduct"),
    {
      stripeProductId: product.id,
      accountId: stored?.accountId ?? opts.accountId,
      name: product.name,
      description: product.description ?? undefined,
      active: product.active,
      metadata: product.metadata,
    },
  );
  const adopted = await ctx.runQuery(
    componentRef(component, "products/queries/getProductByStripeId"),
    { stripeProductId: product.id },
  );
  if (!adopted)
    throwStripeError(
      "PRODUCT_NOT_FOUND",
      "Product mirror is unavailable after adoption",
    );
  return { productId: adopted._id, stripeProductId: product.id };
}

function validateOptions(opts: EnsurePriceOptions) {
  validateLookupKey(opts.lookupKey);
  if (
    !opts.idempotencyKey.trim() ||
    opts.idempotencyKey.length > 255 ||
    !opts.stripeProductId.trim()
  )
    throwStripeError(
      "INVALID_CONFIGURATION",
      "A product and caller-scoped idempotencyKey are required",
    );
  if (
    !Number.isSafeInteger(opts.unitAmount) ||
    opts.unitAmount < 0 ||
    !getChargeCurrencyMetadata(opts.currency ?? "usd")
  )
    throwStripeError(
      "INVALID_CONFIGURATION",
      "Invalid price amount or currency",
    );
  if (opts.type === "recurring") {
    const count = opts.intervalCount ?? 1;
    const max = { day: 1095, week: 156, month: 36, year: 3 };
    if (
      !opts.interval ||
      !(opts.interval in max) ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > max[opts.interval]
    )
      throwStripeError(
        "INVALID_CONFIGURATION",
        "Invalid recurring price interval",
      );
  } else if (
    opts.type !== "one_time" ||
    opts.interval !== undefined ||
    opts.intervalCount !== undefined
  )
    throwStripeError(
      "INVALID_CONFIGURATION",
      "One-time prices cannot have recurrence",
    );
}

function verifyPrice(price: Stripe.Price, opts: EnsurePriceOptions) {
  const productId =
    typeof price.product === "string" ? price.product : price.product.id;
  const recurringMatches =
    opts.type === "recurring"
      ? price.recurring?.interval === opts.interval &&
        price.recurring?.interval_count === (opts.intervalCount ?? 1) &&
        price.recurring?.usage_type === "licensed"
      : price.recurring === null;
  if (
    !price.active ||
    price.lookup_key !== opts.lookupKey ||
    productId !== opts.stripeProductId ||
    price.currency !== (opts.currency ?? "usd").toLowerCase() ||
    price.unit_amount !== opts.unitAmount ||
    price.type !== opts.type ||
    price.billing_scheme !== "per_unit" ||
    price.transform_quantity != null ||
    !recurringMatches
  )
    throwStripeError(
      "INVALID_CONFIGURATION",
      "Lookup key refers to an incompatible price; choose a new versioned key",
    );
}

/** Ensures immutable price terms without transferring keys or changing existing subscriptions. */
export async function ensurePrice(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: EnsurePriceOptions,
) {
  validateOptions(opts);
  let price = await getStripePriceByLookupKey(stripe, opts);
  if (!price) {
    try {
      price = await stripe.prices.create(
        {
          product: opts.stripeProductId,
          unit_amount: opts.unitAmount,
          currency: (opts.currency ?? "usd").toLowerCase(),
          lookup_key: opts.lookupKey,
          nickname: opts.nickname,
          metadata: opts.metadata,
          ...(opts.type === "recurring"
            ? {
                recurring: {
                  interval: opts.interval!,
                  interval_count: opts.intervalCount ?? 1,
                },
              }
            : {}),
        },
        { idempotencyKey: opts.idempotencyKey },
      );
    } catch (error) {
      // Reconcile provider races/unknown responses, but never retry a Stripe write here.
      try {
        price = await getStripePriceByLookupKey(stripe, opts);
      } catch {
        throw error;
      }
      if (!price) throw error;
    }
  }
  verifyPrice(price, opts);
  const product = await adoptProduct(stripe, component, ctx, {
    stripeProductId: opts.stripeProductId,
  });
  await runMutationOrThrow(
    ctx,
    componentRef(component, "products/mutations/upsertPrice"),
    {
      stripePriceId: price.id,
      productId: product.productId,
      stripeProductId: product.stripeProductId,
      nickname: price.nickname ?? undefined,
      unitAmount: price.unit_amount!,
      currency: price.currency,
      active: price.active,
      type: price.type,
      interval: price.recurring?.interval,
      intervalCount: price.recurring?.interval_count,
      metadata: price.metadata,
    },
  );
  return { stripePriceId: price.id };
}
