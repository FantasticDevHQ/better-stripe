// TEST-only fixed raw baseline from immutable 0.90 Source. No SDK/V1 claims or provider evidence.
const API_VERSION = "2026-09-30.endive",
  START = 1768435200,
  END = 1771113600,
  OBSERVED = 1768867200;
function price(id: string, product: string, interval: "month", count: number) {
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
    unit_amount: id === "price_target" ? 2000 : 1000,
    unit_amount_decimal: id === "price_target" ? "2000" : "1000",
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

function nativePlanForPrice(p: ReturnType<typeof price>) {
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

function discount(level: "subscription" | "item", start: number) {
  return {
    id: `di_${level}`,
    object: "discount",
    customer: "cus_buyer",
    customer_account: "acct_buyer",
    start: start - 100,
    end: null,
    subscription: level === "subscription" ? "sub_original" : null,
    subscription_item: level === "item" ? "si_original" : null,
    source: {
      type: "coupon",
      coupon: {
        id: `custom-${level}-offer`,
        object: "coupon",
        livemode: false,
        duration: "forever",
        duration_in_months: null,
        amount_off: null,
        currency: null,
        percent_off: level === "subscription" ? 10 : 5,
        max_redemptions: null,
        redeem_by: null,
        times_redeemed: 2,
        created: start - 1000,
        name: null,
        metadata: { keep: "coupon" },
        valid: true,
        applies_to: { products: ["custom-original", "custom-target"] },
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

export function makeConfigureReadNativeBaseline() {
  const start = START;
  const end = END;
  const observedAt = OBSERVED;
  const currentPrice = price("price_original", "custom-original", "month", 1);
  const targetPrice = {
    ...price("price_target", "custom-target", "month", 1),
  };
  const originalItem = {
    id: "si_original",
    object: "subscription_item",
    subscription: "sub_original",
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
  };
  const subscription = {
    id: "sub_original",
    object: "subscription",
    customer: "cus_buyer",
    customer_account: "acct_buyer",
    livemode: false,
    status: "active",
    latest_invoice: "in_original",
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
  };
  const billingCustomer = {
    id: "cus_buyer",
    object: "customer",
    customer_account: "acct_buyer",
    livemode: false,
    discount: null,
    next_invoice_sequence: 3,
    metadata: { keep: "customer" },
  };
  const expected = {
    customerAccountId: "acct_buyer",
    subscriptionId: "sub_original",
    itemId: "si_original",
    currentPriceId: "price_original",
    currentProductId: "custom-original",
    targetPriceId: "price_target",
    targetProductId: "custom-target",
    periodStart: start,
    periodEnd: end,
    livemode: false,
  };
  const phaseItem = {
    price: "price_original",
    plan: "price_original",
    quantity: 3,
    billing_thresholds: null,
    tax_rates: [],
    metadata: {},
    discounts: [
      {
        discount: "di_item",
        coupon: "custom-item-offer",
        promotion_code: null,
      },
    ],
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
        discount: "di_subscription",
        coupon: "custom-subscription-offer",
        promotion_code: null,
      },
    ],
  };
  const schedule = {
    id: "sub_sched_owned",
    object: "subscription_schedule",
    application: null,
    customer: "cus_buyer",
    customer_account: "acct_buyer",
    livemode: false,
    subscription: "sub_original",
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
  };

  const preparation = {
    subscription,
    targetPrice,
    billingCustomer,
    expected,
    key: "renewal:logical-original",
  };
  const attachRequest = {
    preparation,
    apiVersion: API_VERSION,
    attachKey: "renewal:attach-original",
    firstDispatchedAt: observedAt - 60,
  };
  const subCoupon = structuredClone(subscription.discounts[0].source.coupon),
    itemCoupon = structuredClone(originalItem.discounts[0].source.coupon);
  const couponReads = [
    {
      couponId: subCoupon.id,
      wireCoupon: subCoupon,
      association: { resource: "coupon", ordinal: 4 },
    },
    {
      couponId: itemCoupon.id,
      wireCoupon: itemCoupon,
      association: { resource: "coupon", ordinal: 5 },
    },
  ];
  const derivedCouponJoins = {
    subscription: [
      {
        index: 0,
        discountId: "di_subscription",
        originalCouponReference: structuredClone(subCoupon),
        couponReadIndex: 0,
        joinedDiscount: structuredClone(subscription.discounts[0]),
      },
    ],
    item: [
      {
        index: 0,
        discountId: "di_item",
        originalCouponReference: structuredClone(itemCoupon),
        couponReadIndex: 1,
        joinedDiscount: structuredClone(originalItem.discounts[0]),
      },
    ],
  };
  const originalBundle = {
    wireSubscription: structuredClone(subscription),
    wireTargetPrice: structuredClone(targetPrice),
    wireBillingCustomer: structuredClone(billingCustomer),
    couponReads,
    derivedCouponJoins,
  };
  return {
    original: { attachRequest, originalBundle },
    schedule,
    configurationTime: observedAt,
    configureKey: "renewal:configure-original",
    apiVersion: API_VERSION,
    clockPlan: Object.freeze({
      attachSeconds: observedAt - 60,
      observationSeconds: observedAt,
      workSeconds: 180,
      endSeconds: 210,
    }),
  };
}
