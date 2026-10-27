import type Stripe from "stripe";
import { z } from "zod";
import { projectRenewalDiscounts } from "../renewalProjection/discounts.js";
import { projectRenewalPhaseSettings } from "../renewalProjection/settings.js";
import { projectRenewalItemSettings } from "../renewalProjection/itemSettings.js";
import { settingsInput, taxRate } from "../renewalProjection/settingsSchema.js";
import { defaultsSchema, contextFor } from "./phaseContext.js";
import {
  object,
  timestamp,
  referenceId,
  productId,
  equal,
  unsupported,
} from "./shared.js";
import type { validateReads } from "./preflight.js";
import type { OriginalRedemptions } from "./sourceDiscounts.js";
import { preserveTaxLevels } from "./taxRetention.js";

const itemSchema = z
  .object({
    price: z.unknown(),
    plan: z.unknown().optional(),
    quantity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    billing_thresholds: z.null(),
    discounts: z.array(z.unknown()).max(20),
    tax_rates: z.array(taxRate).max(20).nullable().optional(),
    metadata: settingsInput.shape.settings.shape.metadata,
  })
  .strict();
const phaseSchema = settingsInput.shape.settings
  .extend({
    start_date: timestamp,
    end_date: timestamp,
    currency: z.string().regex(/^[a-z]{3}$/),
    billing_cycle_anchor: z.enum(["automatic", "phase_start"]).nullable(),
    discounts: z.array(z.unknown()).max(20),
    items: z.tuple([itemSchema]),
    add_invoice_items: z.array(z.unknown()).length(0),
    proration_behavior: z.enum(["none", "always_invoice", "create_prorations"]),
    trial: z.literal(false).optional(),
    trial_end: z.null(),
  })
  .strict();

function phaseReferences(value: unknown[], originals: OriginalRedemptions) {
  return value.map((entry, index) => {
    const reference = object(entry);
    const original = originals[index];
    if (!original || reference.promotion_code != null)
      unsupported("unsupported_phase_discount_reference");
    const normalize = (value: unknown, source: unknown, kind: string) => {
      if (value == null || typeof value === "string") return value;
      const expanded = object(value);
      const minimal = Object.keys(expanded).every((key) =>
        ["id", "object", "deleted"].includes(key),
      );
      if (
        expanded.object !== kind ||
        expanded.deleted === true ||
        (!minimal && !equal(expanded, source))
      )
        unsupported("phase_discount_expansion_mismatch");
      return z.string().parse(expanded.id);
    };
    return {
      discount: normalize(reference.discount, original, "discount"),
      coupon:
        normalize(reference.coupon, original.source.coupon, "coupon") ?? null,
      promotion_code: null,
    };
  });
}

function metadataMatches(
  actions: Record<string, string> | null,
  actual: unknown,
) {
  const existing = object(actual);
  if (
    actions &&
    Object.entries(actions).some(([key, value]) => existing[key] !== value)
  )
    unsupported("metadata_action_conflict");
}

export function assemblePhases(
  reads: ReturnType<typeof validateReads>,
  schedule: Record<string, unknown>,
) {
  const defaultsResult = defaultsSchema.safeParse(schedule.default_settings);
  if (!defaultsResult.success) unsupported("unsupported_schedule_defaults");
  if (!Array.isArray(schedule.phases) || schedule.phases.length !== 1)
    unsupported("unsupported_phase_configuration");
  const parsedPhase = phaseSchema.safeParse(schedule.phases[0]);
  if (!parsedPhase.success) unsupported("unsupported_phase_mapping");
  const phase = parsedPhase.data;
  const phaseItem = phase.items[0];
  preserveTaxLevels(
    reads.originalSettings.taxLevels,
    phase.default_tax_rates,
    phaseItem.tax_rates,
  );
  const expected = reads.prepared.expected;
  const referenceContext = {
    livemode: expected.livemode,
    customerAccountId: expected.customerAccountId,
  };
  if (
    phase.start_date !== expected.periodStart ||
    phase.end_date !== expected.periodEnd ||
    phase.currency !== reads.subscription.currency ||
    phaseItem.quantity !== reads.prepared.quantity ||
    referenceId(phaseItem.price, "price", "price", referenceContext) !==
      expected.currentPriceId
  )
    unsupported("phase_original_identity_mismatch");
  if (
    phaseItem.plan !== undefined &&
    referenceId(phaseItem.plan, "price", "plan", referenceContext) !==
      expected.currentPriceId
  )
    unsupported("phase_plan_price_mismatch");
  for (const reference of [phaseItem.price, phaseItem.plan]) {
    if (typeof reference !== "object" || reference === null) continue;
    const expanded = object(reference);
    if (
      (expanded.product !== undefined &&
        productId(expanded.product, referenceContext) !==
          expected.currentProductId) ||
      (expanded.currency !== undefined && expanded.currency !== phase.currency)
    )
      unsupported("phase_price_material_mismatch");
  }
  const context = contextFor(
    phase,
    defaultsResult.data,
    reads.subscription,
    reads.customer.id,
    expected.customerAccountId,
    expected.livemode,
    reads.originalSettings,
  );
  metadataMatches(phase.metadata, reads.subscription.metadata);
  metadataMatches(phaseItem.metadata, reads.item.metadata);
  const {
    start_date,
    end_date,
    currency,
    items: _items,
    discounts,
    add_invoice_items: _invoiceItems,
    billing_cycle_anchor,
    proration_behavior,
    trial: _trial,
    trial_end: _trialEnd,
    ...phaseSettings
  } = phase;
  const settings = projectRenewalPhaseSettings({
    context,
    settings: phaseSettings,
  });
  if (settings.status !== "projected") unsupported(settings.reason);
  const itemSettings = projectRenewalItemSettings({
    effectiveAutomaticTax: context.effectiveAutomaticTax,
    livemode: expected.livemode,
    settings: {
      billing_thresholds: phaseItem.billing_thresholds,
      ...(phaseItem.tax_rates === undefined
        ? {}
        : { tax_rates: phaseItem.tax_rates }),
      metadata: phaseItem.metadata,
    },
  });
  if (itemSettings.status !== "projected") unsupported(itemSettings.reason);
  const discountContext = {
    customerAccountId: expected.customerAccountId,
    subscriptionId: expected.subscriptionId,
    itemId: expected.itemId,
    currentProductId: expected.currentProductId,
    targetProductId: expected.targetProductId,
  };
  const phaseDiscount = projectRenewalDiscounts({
    ...discountContext,
    level: "subscription",
    redemptions: reads.discounts,
    phaseDiscounts: phaseReferences(discounts, reads.discounts),
  });
  const itemDiscount = projectRenewalDiscounts({
    ...discountContext,
    level: "subscription_item",
    redemptions: reads.itemDiscounts,
    phaseDiscounts: phaseReferences(phaseItem.discounts, reads.itemDiscounts),
  });
  if (phaseDiscount.status !== "projected") unsupported(phaseDiscount.reason);
  if (itemDiscount.status !== "projected") unsupported(itemDiscount.reason);
  const effectiveAnchor =
    billing_cycle_anchor ?? defaultsResult.data.billing_cycle_anchor;
  if (
    effectiveAnchor === "phase_start" &&
    reads.subscription.billing_cycle_anchor !== start_date
  )
    unsupported("current_phase_anchor_reset_unsupported");
  const current: Stripe.SubscriptionScheduleUpdateParams.Phase = {
    ...settings.settings,
    start_date,
    end_date,
    currency,
    proration_behavior,
    items: [
      {
        ...itemSettings.settings,
        price: expected.currentPriceId,
        quantity: reads.prepared.quantity,
        discounts: itemDiscount.discounts,
      },
    ],
    discounts: phaseDiscount.discounts,
    ...(billing_cycle_anchor === null ? {} : { billing_cycle_anchor }),
  };
  const recurring = reads.targetPrice.recurring;
  const target: Stripe.SubscriptionScheduleUpdateParams.Phase = {
    ...settings.settings,
    start_date: end_date,
    currency,
    proration_behavior: "none",
    billing_cycle_anchor:
      reads.profile.cadence === "same" ? "automatic" : "phase_start",
    duration: {
      interval: recurring.interval,
      interval_count: recurring.interval_count,
    },
    items: [
      {
        ...itemSettings.settings,
        price: expected.targetPriceId,
        quantity: reads.prepared.quantity,
        discounts: itemDiscount.discounts,
      },
    ],
    discounts: phaseDiscount.discounts,
  };
  return [current, target];
}
