import { z } from "zod";
import { componentRef } from "../webhooks/helpers.js";
import { catalogScope } from "./catalogTypes.js";
import { defineUsagePlan } from "./contracts.js";
import type { Doc } from "../../component/_generated/dataModel.js";
import type { Component, RunCtx } from "../helpers.js";
import type { UsageCatalogScope } from "./catalogTypes.js";
import type { UsageAvailability } from "./boundaries.js";
import type { UsagePlan } from "./contracts.js";
export type UsagePriceBinding = {
  pricingMode: "metered";
  stripePriceId: string;
  stripeProductId: string;
  meterId: string;
  active: boolean;
  currency: string;
  billingScheme: "per_unit" | "tiered";
  unitAmountDecimal: string | null;
  tiers: Array<{ upTo: string | null; unitAmountDecimal: string }>;
  interval: "month";
  plan: UsagePlan;
};
const observation = z.strictObject({
  type: z.literal("metered_price"),
  id: z.string(),
  productId: z.string(),
  meterId: z.string(),
  livemode: z.boolean(),
  active: z.boolean(),
  currency: z.string(),
  billingScheme: z.enum(["per_unit", "tiered"]),
  unitAmountDecimal: z.string().nullable(),
  tiers: z.array(
    z.strictObject({
      upTo: z.string().nullable(),
      unitAmountDecimal: z.string(),
    }),
  ),
  interval: z.literal("month"),
});
export async function getUsagePriceBinding(
  component: Component,
  ctx: RunCtx,
  opts: { scope: UsageCatalogScope; lookupKey: string },
): Promise<UsageAvailability<UsagePriceBinding>> {
  const scope = catalogScope(opts.scope);
  const key = z.string().min(1).max(200).parse(opts.lookupKey);
  const row = (await ctx.runQuery(
    componentRef(component, "usageCatalog/queries/get"),
    { scopeKey: JSON.stringify(scope), kind: "price", key },
  )) as Doc<"usageCatalog"> | null;
  if (!row)
    return {
      status: "unavailable",
      reason: "catalog_not_found",
      retryable: false,
    };
  if (!row.observationJson || row.observedAt === undefined)
    return {
      status: "unavailable",
      reason: "catalog_pending",
      retryable: true,
    };
  try {
    const price = observation.parse(JSON.parse(row.observationJson));
    const plan = defineUsagePlan(JSON.parse(row.termsJson).plan);
    if (
      price.id !== row.providerId ||
      price.livemode !== scope.livemode ||
      price.currency !== plan.rate.currency ||
      (price.billingScheme === "per_unit" && price.unitAmountDecimal === null)
    )
      throw new Error("Invalid catalog observation");
    return {
      status: "available",
      observedAt: row.observedAt,
      value: {
        pricingMode: "metered",
        stripePriceId: price.id,
        stripeProductId: price.productId,
        meterId: price.meterId,
        active: price.active,
        currency: price.currency,
        billingScheme: price.billingScheme,
        unitAmountDecimal: price.unitAmountDecimal,
        tiers: price.tiers,
        interval: price.interval,
        plan,
      },
    };
  } catch {
    return {
      status: "unavailable",
      reason: "invalid_catalog_observation",
      retryable: false,
    };
  }
}
