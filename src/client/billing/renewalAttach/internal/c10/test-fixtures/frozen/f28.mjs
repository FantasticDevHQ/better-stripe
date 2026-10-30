import { INTENT } from "./f25.mjs";

// Synthetic provider-shaped reads. These unit fixtures are not provider receipts.
export const API_VERSION = "2026-09-30.endive";
export const stamp = (iso) => Date.parse(iso) / 1000;
const START = INTENT.T0;
const END = INTENT.T1;
const OBSERVED = INTENT.OBSERVED;

export function alter(value, path, next) {
  const result = structuredClone(value);
  let cursor = result;
  for (const key of path.slice(0, -1)) cursor = cursor[key];
  cursor[path[path.length - 1]] = next;
  return result;
}

export function price(id, product, interval, count) {
  return {
    id,
    object: "price",
    product,
    active: true,
    livemode: false,
    type: "recurring",
    currency: "usd",
    billing_scheme: "per_unit",
    created: START - 1000,
    metadata: { catalog: "retained" },
    nickname: id,
    unit_amount: id === INTENT.PRICE_TARGET ? 2000 : 1000,
    unit_amount_decimal: id === INTENT.PRICE_TARGET ? "2000" : "1000",
    tiers_mode: null,
    transform_quantity: null,
    recurring: {
      interval,
      interval_count: count,
      usage_type: "licensed",
      meter: null,
      trial_period_days: null,
    },
  };
}

// Raw JSON wire shape: Stripe23 declares Decimal objects, while HTTP JSON parsing retains strings.

export function nativePlanForPrice(p) {
  return {
    id: p.id,
    object: "plan",
    active: p.active,
    amount: p.unit_amount,
    amount_decimal: p.unit_amount_decimal,
    billing_scheme: "per_unit",
    created: p.created,
    currency: p.currency,
    interval: p.recurring.interval,
    interval_count: p.recurring.interval_count,
    livemode: p.livemode,
    metadata: p.metadata,
    meter: p.recurring.meter,
    nickname: p.nickname,
    product: p.product,
    tiers_mode: null,
    transform_usage: null,
    trial_period_days: p.recurring.trial_period_days,
    usage_type: "licensed",
  };
}

function discount(level, start) {
  return {
    id: `di_${level}`,
    object: "discount",
    customer: INTENT.MIRROR,
    customer_account: INTENT.BUYER,
    start: start - 100,
    end: null,
    subscription: level === "subscription" ? INTENT.SUB_SCHEDULED : null,
    subscription_item: level === "item" ? INTENT.ITEM_SCHEDULED : null,
    source: {
      type: "coupon",
      coupon: {
        id: `custom-${level}-offer`,
        object: "coupon",
        livemode: false,
        duration: "forever",
        valid: true,
        applies_to: {
          products: [INTENT.PRODUCT_ORIGINAL, INTENT.PRODUCT_TARGET],
        },
      },
    },
  };
}

const invoiceSettings = () => ({
  account_tax_ids: null,
  custom_fields: null,
  days_until_due: null,
  description: null,
  footer: null,
  issuer: { type: "self" },
});

export function fixture(options = {}) {
  const start = options.start ?? START;
  const end = options.end ?? END;
  const observedAt = options.observedAt ?? OBSERVED;
  const currentPrice = price(
    INTENT.PRICE_ORIGINAL,
    INTENT.PRODUCT_ORIGINAL,
    options.currentInterval ?? "month",
    options.currentCount ?? 1,
  );
  const targetPrice = {
    ...price(
      INTENT.PRICE_TARGET,
      INTENT.PRODUCT_TARGET,
      options.targetInterval ?? "month",
      options.targetCount ?? 1,
    ),
    ...options.target,
  };
  const originalItem = {
    id: INTENT.ITEM_SCHEDULED,
    object: "subscription_item",
    subscription: INTENT.SUB_SCHEDULED,
    current_period_start: start,
    current_period_end: end,
    quantity: 3,
    price: currentPrice,
    plan: nativePlanForPrice(currentPrice),
    billing_thresholds: null,
    current_trial: null,
    tax_rates: [],
    discounts: [discount("item", start)],
    metadata: { seat: "retained" },
    ...options.item,
  };
  if (options.omitItemCurrentTrial) delete originalItem.current_trial;
  const subscription = {
    id: INTENT.SUB_SCHEDULED,
    object: "subscription",
    customer: INTENT.MIRROR,
    customer_account: INTENT.BUYER,
    livemode: false,
    status: "active",
    currency: "usd",
    schedule: null,
    cancel_at: null,
    cancel_at_period_end: false,
    canceled_at: null,
    ended_at: null,
    pause_collection: null,
    pending_update: null,
    pending_setup_intent: null,
    pending_invoice_item_interval: null,
    next_pending_invoice_item_invoice: null,
    managed_payments: null,
    billing_schedules: [],
    billing_thresholds: null,
    billing_mode: { type: "classic", flexible: null },
    billing_cycle_anchor: start,
    billing_cycle_anchor_config: null,
    default_source: null,
    default_payment_method: null,
    application_fee_percent: null,
    payment_settings: {
      payment_method_options: null,
      payment_method_types: null,
      save_default_payment_method: "off",
    },
    collection_method: "charge_automatically",
    days_until_due: null,
    automatic_tax: { enabled: false, liability: null, disabled_reason: null },
    default_tax_rates: [],
    description: null,
    invoice_settings: {
      account_tax_ids: null,
      custom_fields: null,
      description: null,
      footer: null,
      issuer: { type: "self" },
    },
    on_behalf_of: null,
    transfer_data: null,
    discounts: [discount("subscription", start)],
    metadata: { keep: "original" },
    trial_start: start - 100_000,
    trial_end: start - 90_000,
    trial_settings: null,
    items: { object: "list", has_more: false, data: [originalItem] },
    ...options.subscription,
  };
  const billingCustomer = {
    id: INTENT.MIRROR,
    object: "customer",
    customer_account: INTENT.BUYER,
    livemode: false,
    discount: null,
    ...(options.customer ?? {}),
  };
  const expected = {
    customerAccountId: INTENT.BUYER,
    subscriptionId: INTENT.SUB_SCHEDULED,
    itemId: INTENT.ITEM_SCHEDULED,
    currentPriceId: INTENT.PRICE_ORIGINAL,
    currentProductId: INTENT.PRODUCT_ORIGINAL,
    targetPriceId: INTENT.PRICE_TARGET,
    targetProductId: INTENT.PRODUCT_TARGET,
    periodStart: start,
    periodEnd: end,
    livemode: false,
  };
  const phaseItem = {
    price: INTENT.PRICE_ORIGINAL,
    plan: INTENT.PRICE_ORIGINAL,
    quantity: 3,
    billing_thresholds: null,
    tax_rates: [],
    metadata: {},
    discounts: [
      {
        discount: INTENT.DISCOUNT_S_ITEM,
        coupon: INTENT.COUPON_ITEM,
        promotion_code: null,
      },
    ],
    ...options.phaseItem,
  };
  const defaults = {
    application_fee_percent: null,
    automatic_tax: { enabled: false, liability: null, disabled_reason: null },
    billing_cycle_anchor: "automatic",
    billing_thresholds: null,
    collection_method: "charge_automatically",
    default_payment_method: null,
    description: null,
    invoice_settings: invoiceSettings(),
    on_behalf_of: null,
    transfer_data: null,
    ...options.defaults,
  };
  const phase = {
    start_date: start,
    end_date: end,
    currency: "usd",
    items: [phaseItem],
    add_invoice_items: [],
    application_fee_percent: null,
    billing_cycle_anchor: null,
    billing_thresholds: null,
    collection_method: null,
    default_payment_method: null,
    default_tax_rates: [],
    description: null,
    invoice_settings: null,
    metadata: {},
    on_behalf_of: null,
    transfer_data: null,
    proration_behavior: "create_prorations",
    trial: false,
    trial_end: null,
    discounts: [
      {
        discount: INTENT.DISCOUNT_S_SUB,
        coupon: INTENT.COUPON_SUBSCRIPTION,
        promotion_code: null,
      },
    ],
    ...options.phase,
  };
  const schedule = {
    id: INTENT.SCHEDULE,
    object: "subscription_schedule",
    application: null,
    customer: INTENT.MIRROR,
    customer_account: INTENT.BUYER,
    livemode: false,
    subscription: INTENT.SUB_SCHEDULED,
    status: "active",
    end_behavior: "release",
    created: observedAt - 60,
    canceled_at: null,
    completed_at: null,
    released_at: null,
    released_subscription: null,
    metadata: {},
    test_clock: null,
    billing_mode: subscription.billing_mode,
    pause_schedules: [],
    current_phase: { start_date: start, end_date: end },
    default_settings: defaults,
    phases: [phase],
    ...(options.schedule ?? {}),
  };
  return {
    subscription,
    originalItem,
    targetPrice,
    billingCustomer,
    expected,
    phase,
    defaults,
    schedule,
    observedAt,
  };
}
