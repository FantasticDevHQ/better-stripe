import type Stripe from "stripe";
import { z } from "zod";
import type { Component, RunCtx } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import {
  UsageCatalogError,
  meterTerms,
  meterKey,
  verifyRealm,
  verifyMeter,
  meterObservation,
  prepareCatalog,
  completeCatalog,
  catalogScope,
  nativeCall,
  type UsageCatalogScope,
  type UsageMeterOptions,
} from "./catalogTypes.js";
import type { Doc } from "../../component/_generated/dataModel.js";
const meterId = z
  .string()
  .regex(/^mtr_[a-zA-Z0-9_]+$/)
  .max(100);
export async function adoptUsageMeter(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: UsageMeterOptions & { meterId: string },
): Promise<Stripe.Billing.Meter> {
  const terms = meterTerms(opts);
  const meter = await getUsageMeterFromStripe(stripe, {
    scope: terms.scope,
    meterId: opts.meterId,
  });
  verifyMeter(meter, terms, false);
  const row = await prepareCatalog(
    component,
    ctx,
    "meter",
    terms.scope,
    meterKey(terms.plan),
    terms,
  );
  await completeCatalog(component, ctx, row, meter.id, meterObservation(meter));
  return meter;
}
export async function getUsageMeterFromStripe(
  stripe: Stripe,
  opts: { scope: UsageCatalogScope; meterId: string },
): Promise<Stripe.Billing.Meter> {
  const id = meterId.parse(opts.meterId);
  await verifyRealm(stripe, opts.scope);
  const meter = await nativeCall(() => stripe.billing.meters.retrieve(id));
  if (meter.id !== id || meter.livemode !== opts.scope.livemode)
    throw new UsageCatalogError(
      "incompatible_terms",
      "Native meter identity or mode mismatch",
    );
  return meter;
}
export async function listStripeUsageMeters(
  stripe: Stripe,
  opts: { scope: UsageCatalogScope; limit: number; cursor?: string },
): Promise<{
  data: Stripe.Billing.Meter[];
  hasMore: boolean;
  cursor: string | null;
}> {
  const limit = z.number().int().min(1).max(100).parse(opts.limit);
  const cursor = meterId.optional().parse(opts.cursor);
  await verifyRealm(stripe, opts.scope);
  const page = await nativeCall(() =>
    stripe.billing.meters.list({ limit, starting_after: cursor }),
  );
  if (
    page.data.some((meter) => meter.livemode !== opts.scope.livemode) ||
    (page.has_more && !page.data.length)
  )
    throw new UsageCatalogError(
      "ambiguous_lookup",
      "Native meter page is inconsistent",
    );
  return {
    data: page.data,
    hasMore: page.has_more,
    cursor: page.has_more ? page.data[page.data.length - 1].id : null,
  };
}
export async function setUsageMeterActive(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: { scope: UsageCatalogScope; meterId: string; active: boolean },
): Promise<Stripe.Billing.Meter> {
  const current = await getUsageMeterFromStripe(stripe, opts);
  const row = (await ctx.runQuery(
    componentRef(component, "usageCatalog/queries/getByProvider"),
    {
      scopeKey: JSON.stringify(catalogScope(opts.scope)),
      kind: "meter",
      providerId: opts.meterId,
    },
  )) as Doc<"usageCatalog"> | null;
  if (!row)
    throw new UsageCatalogError(
      "incompatible_terms",
      "Adopt a native meter before changing its lifecycle",
    );
  const terms = meterTerms(JSON.parse(row.termsJson) as UsageMeterOptions);
  verifyMeter(current, terms, false);
  const target = opts.active ? "active" : "inactive";
  const meter =
    current.status === target
      ? current
      : await nativeCall(() =>
          opts.active
            ? stripe.billing.meters.reactivate(opts.meterId)
            : stripe.billing.meters.deactivate(opts.meterId),
        );
  verifyMeter(meter, terms, false);
  if (meter.id !== opts.meterId || meter.status !== target)
    throw new UsageCatalogError(
      "provider_unavailable",
      "Native meter lifecycle outcome is uncertain",
    );
  await completeCatalog(component, ctx, row, meter.id, meterObservation(meter));
  return meter;
}
