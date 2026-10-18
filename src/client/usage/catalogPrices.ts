import Stripe from "stripe";
import { z } from "zod";
import type { Component, RunCtx } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import { getChargeCurrencyMetadata } from "../charge-currency.js";
import { defineUsagePlan, parseUsageQuantity } from "./contracts.js";
import { scaledUsageRate } from "./catalogMath.js";

import {
  UsageCatalogError,
  verifyMeter,
  catalogScope,
  meterKey,
  meterTerms,
  verifyRealm,
  prepareCatalog,
  completeCatalog,
  operationKey,
  permitCreate,
  nativeCall,
  type UsageMeterOptions,
  type UsagePriceOptions,
} from "./catalogTypes.js";
import type { Doc } from "../../component/_generated/dataModel.js";
function incompatible(): never {
  throw new UsageCatalogError(
    "incompatible_terms",
    "Native price has incompatible immutable terms",
  );
}
function decimal(
  value: Stripe.Decimal | string | null | undefined,
  integer: number | null | undefined,
) {
  const text =
    value?.toString() ??
    (Number.isSafeInteger(integer) && integer !== null && integer !== undefined
      ? String(integer)
      : undefined);
  if (text === undefined || !/^\d+(\.\d{1,12})?$/.test(text))
    return incompatible();
  const [whole, fraction = ""] = text.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  const normalized = BigInt(whole).toString();
  return trimmed ? `${normalized}.${trimmed}` : normalized;
}
function termsFor(opts: UsagePriceOptions) {
  const plan = defineUsagePlan(opts.plan);
  if (!getChargeCurrencyMetadata(plan.rate.currency)) return incompatible();
  const terms = {
    scope: catalogScope(opts.scope),
    plan,
    meterId: z
      .string()
      .regex(/^mtr_[a-zA-Z0-9_]+$/)
      .max(100)
      .parse(opts.meterId),
    stripeProductId: z
      .string()
      .regex(/^prod_[a-zA-Z0-9]+$/)
      .max(100)
      .parse(opts.stripeProductId),
    lookupKey: z.string().min(1).max(200).parse(opts.lookupKey),
  };
  const rate = scaledUsageRate(
    plan.rate.unitAmountDecimal,
    plan.unit.precision,
  );
  let included: number | undefined;
  if (plan.model === "included_overage") {
    const scaled = BigInt(
      parseUsageQuantity(plan.includedQuantity, plan.unit.precision)
        .scaledQuantity,
    );
    if (scaled < 1n || scaled > BigInt(Number.MAX_SAFE_INTEGER))
      return incompatible();
    included = Number(scaled);
  }
  return { terms, rate, included };
}
function verifyPrice(
  price: Stripe.Price,
  opts: UsagePriceOptions,
  rate: string,
  included: number | undefined,
) {
  const product =
    typeof price.product === "string" ? price.product : price.product.id;
  if (
    !price.active ||
    price.livemode !== opts.scope.livemode ||
    price.lookup_key !== opts.lookupKey ||
    product !== opts.stripeProductId ||
    price.currency !== opts.plan.rate.currency ||
    price.type !== "recurring" ||
    price.recurring?.interval !== "month" ||
    price.recurring.interval_count !== 1 ||
    price.recurring.usage_type !== "metered" ||
    price.recurring.meter !== opts.meterId ||
    price.transform_quantity != null
  )
    return incompatible();
  if (included === undefined) {
    if (
      price.billing_scheme !== "per_unit" ||
      decimal(price.unit_amount_decimal, price.unit_amount) !== rate
    )
      return incompatible();
  } else {
    if (
      price.billing_scheme !== "tiered" ||
      price.tiers_mode !== "graduated" ||
      price.tiers?.length !== 2
    )
      return incompatible();
    const [free, overage] = price.tiers;
    if (
      free.up_to !== included ||
      overage.up_to !== null ||
      decimal(free.unit_amount_decimal, free.unit_amount) !== "0" ||
      decimal(overage.unit_amount_decimal, overage.unit_amount) !== rate
    )
      return incompatible();
    for (const tier of price.tiers)
      if (
        (tier.flat_amount != null && tier.flat_amount !== 0) ||
        (tier.flat_amount_decimal != null &&
          decimal(tier.flat_amount_decimal, 0) !== "0")
      )
        return incompatible();
  }
}
export async function ensureUsagePrice(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: UsagePriceOptions,
): Promise<Stripe.Price> {
  const { terms, rate, included } = termsFor(opts);
  await verifyRealm(stripe, terms.scope);
  const meterRow = (await ctx.runQuery(
    componentRef(component, "usageCatalog/queries/get"),
    {
      scopeKey: JSON.stringify(terms.scope),
      kind: "meter",
      key: meterKey(terms.plan),
    },
  )) as Doc<"usageCatalog"> | null;
  if (!meterRow || meterRow.providerId !== terms.meterId) return incompatible();
  const meterOpts = meterTerms(
    JSON.parse(meterRow.termsJson) as UsageMeterOptions,
  );
  if (JSON.stringify(meterOpts.plan) !== JSON.stringify(terms.plan))
    return incompatible();
  const meter = await nativeCall(() =>
    stripe.billing.meters.retrieve(terms.meterId),
  );
  if (meter.id !== terms.meterId) return incompatible();
  verifyMeter(meter, meterOpts);
  const product = await nativeCall(() =>
    stripe.products.retrieve(terms.stripeProductId),
  );
  if (
    "deleted" in product ||
    !product.active ||
    product.id !== terms.stripeProductId
  )
    return incompatible();
  const row = await prepareCatalog(
    component,
    ctx,
    "price",
    terms.scope,
    terms.lookupKey,
    terms,
  );
  let price: Stripe.Price | undefined;
  if (row.providerId)
    price = await nativeCall(() =>
      stripe.prices.retrieve(row.providerId!, { expand: ["tiers"] }),
    );
  else {
    const result = await nativeCall(() =>
      stripe.prices.list({
        lookup_keys: [terms.lookupKey],
        limit: 2,
        expand: ["data.tiers"],
      }),
    );
    if (result.has_more || result.data.length > 1)
      throw new UsageCatalogError(
        "ambiguous_lookup",
        "Native price lookup key is ambiguous",
      );
    price = result.data[0];
  }
  if (!price) {
    permitCreate(row);
    const key = await operationKey(terms, "price");
    const params: Stripe.PriceCreateParams = {
      product: terms.stripeProductId,
      currency: terms.plan.rate.currency,
      lookup_key: terms.lookupKey,
      recurring: {
        interval: "month",
        usage_type: "metered",
        meter: terms.meterId,
      },
      expand: ["tiers"],
      ...(included === undefined
        ? {
            billing_scheme: "per_unit",
            unit_amount_decimal: Stripe.Decimal.from(rate),
          }
        : {
            billing_scheme: "tiered",
            tiers_mode: "graduated",
            tiers: [
              { up_to: included, unit_amount_decimal: Stripe.Decimal.zero },
              { up_to: "inf", unit_amount_decimal: Stripe.Decimal.from(rate) },
            ],
          }),
    };
    price = await nativeCall(() =>
      stripe.prices.create(params, { idempotencyKey: key }),
    );
  }
  verifyPrice(price, terms, rate, included);
  if (row.providerId && row.providerId !== price.id) return incompatible();
  await completeCatalog(component, ctx, row, price.id, {
    type: "metered_price",
    id: price.id,
    productId: terms.stripeProductId,
    meterId: terms.meterId,
    livemode: price.livemode,
    active: price.active,
    currency: price.currency,
    billingScheme: price.billing_scheme,
    unitAmountDecimal:
      price.billing_scheme === "per_unit"
        ? decimal(price.unit_amount_decimal, price.unit_amount)
        : null,
    tiers:
      price.tiers?.map((tier) => ({
        upTo: tier.up_to === null ? null : String(tier.up_to),
        unitAmountDecimal: decimal(tier.unit_amount_decimal, tier.unit_amount),
      })) ?? [],
    interval: "month",
  });
  return price;
}

/** Validate an already pinned native price without creating or adopting it. */
export function verifyPinnedUsagePrice(
  price: Stripe.Price,
  scope: UsagePriceOptions["scope"],
  plan: UsagePriceOptions["plan"],
  meterId: string,
) {
  const productId =
    typeof price.product === "string" ? price.product : price.product.id;
  if (!price.lookup_key) return incompatible();
  const opts = {
    scope,
    plan,
    meterId,
    stripeProductId: productId,
    lookupKey: price.lookup_key,
  };
  const { rate, included } = termsFor(opts);
  verifyPrice(price, opts, rate, included);
}
