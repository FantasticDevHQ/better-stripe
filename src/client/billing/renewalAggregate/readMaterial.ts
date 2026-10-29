import { z } from "zod";
import type { PreparedRenewalPriceReplacement } from "../renewalPriceReplacement.js";
import {
  renewalSubscription,
  renewalPrice,
  renewalBillingCustomer,
} from "../renewalReplacementSchema.js";
import {
  readInput,
  referenceId,
  equal,
  conflict,
  unsupported,
  supportedVersion,
  timestamp,
  resourceId,
  productId,
} from "./shared.js";
import { profileOf } from "./profile.js";
import { qualifySourceDiscounts } from "./sourceDiscounts.js";
import { qualifyOriginalSettings } from "./sourceSettings.js";
// Internal semantic material only. Public wrappers must rebuild their own preparation.
export type RenewalPreparationMaterial = Pick<
  PreparedRenewalPriceReplacement,
  "expected" | "quantity" | "providerSnapshot"
>;
const attachedReference = z.union([
  resourceId("sub_sched"),
  z
    .object({
      id: resourceId("sub_sched"),
      object: z.literal("subscription_schedule"),
      deleted: z.literal(false).optional(),
      customer_account: resourceId("acct").optional(),
      livemode: z.boolean().optional(),
    })
    .passthrough(),
]);

export function validateReadMaterial(
  args: Omit<z.infer<typeof readInput>, "prepared">,
  prepared: RenewalPreparationMaterial,
  scheduleId?: string,
) {
  supportedVersion(args.apiVersion);
  const subscription = renewalSubscription
    .extend({ schedule: scheduleId ? attachedReference : z.null() })
    .safeParse(args.freshSubscription);
  if (!subscription.success)
    unsupported("unsupported_original_subscription_state");
  const source = subscription.data;
  if (scheduleId) {
    if (
      referenceId(source.schedule, "sub_sched", "subscription_schedule") !==
      scheduleId
    )
      conflict("schedule_association_mismatch");
    if (
      typeof source.schedule === "object" &&
      source.schedule !== null &&
      ((source.schedule.customer_account !== undefined &&
        source.schedule.customer_account !==
          prepared.expected.customerAccountId) ||
        (source.schedule.livemode !== undefined &&
          source.schedule.livemode !== prepared.expected.livemode))
    )
      conflict("schedule_association_mismatch");
  }
  const { schedule: originalSchedule, ...original } =
    prepared.providerSnapshot.subscription;
  // Compare complete captured bodies, not parser outputs that may omit own keys.
  const { schedule: freshSchedule, ...fresh } =
    args.freshSubscription as typeof source;
  if (scheduleId ? originalSchedule !== null : freshSchedule !== null)
    conflict("schedule_association_mismatch");
  if (!equal(original, fresh)) conflict("original_source_drift");
  const target = renewalPrice.safeParse(args.targetPrice);
  if (!target.success || !target.data.active)
    unsupported("unsupported_target_price");
  if (!equal(args.targetPrice, prepared.providerSnapshot.targetPrice))
    conflict("target_price_drift");
  if (
    prepared.providerSnapshot.billingCustomer === undefined ||
    args.billingCustomer === undefined
  )
    unsupported("missing_retained_billing_customer");
  const customer = renewalBillingCustomer.safeParse(args.billingCustomer);
  if (!customer.success) unsupported("unsupported_billing_customer");
  if (!equal(args.billingCustomer, prepared.providerSnapshot.billingCustomer))
    conflict("billing_customer_drift");
  const referenceContext = {
    customerAccountId: prepared.expected.customerAccountId,
    livemode: prepared.expected.livemode,
  };
  if (
    referenceId(source.customer, "cus", "customer", referenceContext) !==
      customer.data.id ||
    customer.data.customer_account !== prepared.expected.customerAccountId ||
    customer.data.livemode !== prepared.expected.livemode
  )
    conflict("billing_customer_identity_mismatch");
  const item = source.items.data[0];
  if (
    productId(item.price.product, referenceContext) !==
      prepared.expected.currentProductId ||
    productId(target.data.product, referenceContext) !==
      prepared.expected.targetProductId
  )
    unsupported("product_identity_mismatch");
  if (
    args.observedAt < prepared.expected.periodStart ||
    args.observedAt >= prepared.expected.periodEnd
  )
    unsupported("outside_original_paid_period");
  for (const field of [
    "billing_thresholds",
    "managed_payments",
    "next_pending_invoice_item_invoice",
    "pending_invoice_item_interval",
    "pending_setup_intent",
    "canceled_at",
    "ended_at",
    "trial_settings",
  ])
    if (source[field] !== null) unsupported(`unsupported_original_${field}`);
  if (item.billing_thresholds !== null)
    unsupported("unsupported_item_billing_thresholds");
  if (item.current_trial !== null)
    unsupported("unsupported_or_missing_item_current_trial");
  if (
    !Array.isArray(source.billing_schedules) ||
    source.billing_schedules.length
  )
    unsupported("unsupported_original_billing_schedules");
  if (
    source.trial_end !== null &&
    (!timestamp.safeParse(source.trial_end).success ||
      Number(source.trial_end) > prepared.expected.periodStart)
  )
    unsupported("unsupported_original_trial");
  if (source.status_details != null || source.presentment_details != null)
    unsupported("unsupported_special_billing_state");
  const originalSettings = qualifyOriginalSettings(source, item, customer.data);
  const profile = profileOf(source, item.price, target.data, args.apiVersion);
  const anchor = timestamp.parse(source.billing_cycle_anchor);
  if (anchor > prepared.expected.periodStart)
    unsupported("unqualified_anchor_after_paid_period_start");
  const discounts = qualifySourceDiscounts(
    source.discounts,
    "subscription",
    prepared.expected,
    customer.data.id,
    args.observedAt,
  );
  const itemDiscounts = qualifySourceDiscounts(
    item.discounts,
    "item",
    prepared.expected,
    customer.data.id,
    args.observedAt,
  );
  return {
    prepared,
    subscription: source,
    item,
    customer: customer.data,
    targetPrice: target.data,
    profile,
    discounts,
    itemDiscounts,
    originalSettings,
  };
}

export type RenewalReadMaterial = ReturnType<typeof validateReadMaterial>;
