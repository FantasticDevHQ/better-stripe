import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import {
  UsageCatalogError,
  verifyMeter,
  meterObservation,
  meterTerms,
  meterKey,
  verifyRealm,
  prepareCatalog,
  completeCatalog,
  operationKey,
  permitCreate,
  nativeCall,
  type UsageMeterOptions,
} from "./catalogTypes.js";
export type {
  UsageCatalogScope,
  UsageMeterOptions,
  UsagePriceOptions,
} from "./catalogTypes.js";
export { ensureUsagePrice } from "./catalogPrices.js";

export async function ensureUsageMeter(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: UsageMeterOptions,
): Promise<Stripe.Billing.Meter> {
  const terms = meterTerms(opts);
  await verifyRealm(stripe, terms.scope);
  const row = await prepareCatalog(
    component,
    ctx,
    "meter",
    terms.scope,
    meterKey(terms.plan),
    terms,
  );
  if (row.providerId) {
    const pinned = await nativeCall(() =>
      stripe.billing.meters.retrieve(row.providerId!),
    );
    verifyMeter(pinned, terms);
    if (pinned.id !== row.providerId)
      throw new UsageCatalogError(
        "incompatible_terms",
        "Native meter identity changed",
      );
    await completeCatalog(
      component,
      ctx,
      row,
      pinned.id,
      meterObservation(pinned),
    );
    return pinned;
  }
  let match: Stripe.Billing.Meter | undefined;
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const result = await nativeCall(() =>
      stripe.billing.meters.list({ limit: 100, starting_after: cursor }),
    );
    for (const meter of result.data)
      if (meter.event_name === terms.eventName) {
        if (match)
          throw new UsageCatalogError(
            "ambiguous_lookup",
            "Native meter event name is ambiguous",
          );
        match = meter;
      }
    if (!result.has_more) {
      cursor = undefined;
      break;
    }
    cursor = result.data[result.data.length - 1]?.id;
    if (!cursor)
      throw new UsageCatalogError(
        "ambiguous_lookup",
        "Native meter lookup is incomplete",
      );
  }
  if (cursor)
    throw new UsageCatalogError(
      "ambiguous_lookup",
      "Native meter lookup exceeds its bounded page budget",
    );
  if (!match) {
    permitCreate(row);
    const key = await operationKey(terms, "meter");
    match = await nativeCall(() =>
      stripe.billing.meters.create(
        {
          display_name: terms.displayName,
          event_name: terms.eventName,
          default_aggregation: { formula: "sum" },
          customer_mapping: {
            type: "by_id",
            event_payload_key: "stripe_customer_id",
          },
          value_settings: { event_payload_key: "value" },
        },
        { idempotencyKey: key },
      ),
    );
  }
  verifyMeter(match, terms);
  if (row.providerId && row.providerId !== match.id)
    throw new UsageCatalogError(
      "incompatible_terms",
      "Native meter identity changed",
    );
  await completeCatalog(component, ctx, row, match.id, meterObservation(match));
  return match;
}
