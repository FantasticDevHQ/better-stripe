// Extracted from the maintained 46-test synthetic fixture; no provider resource.
const expected = {
  customerAccountId: "acct_buyer",
  subscriptionId: "sub_original",
  itemId: "si_original",
  currentPriceId: "price_original",
  currentProductId: "prod_original",
  targetPriceId: "price_target",
  targetProductId: "prod_other",
  periodStart: 1700000000,
  periodEnd: 1702592000,
  livemode: false,
};

function price(id = "price_original", product = "prod_original") {
  return {
    id,
    product,
    object: "price",
    active: true,
    livemode: false,
    type: "recurring",
    currency: "usd",
    billing_scheme: "per_unit",
    recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
  };
}
export function input() {
  return {
    expected: structuredClone(expected),
    key: "renewal:original-operation",
    subscription: {
      id: "sub_original",
      object: "subscription",
      customer_account: "acct_buyer",
      status: "active",
      currency: "usd",
      livemode: false,
      schedule: null,
      cancel_at: null,
      cancel_at_period_end: false,
      pause_collection: null,
      pending_update: null,
      default_source: null,
      payment_settings: {
        payment_method_options: null,
        payment_method_types: null,
        save_default_payment_method: "off",
      },
      application_fee_percent: null,
      trial_end: 1690000000,
      items: {
        has_more: false,
        data: [
          {
            id: "si_original",
            object: "subscription_item",
            subscription: "sub_original",
            current_period_start: expected.periodStart,
            current_period_end: expected.periodEnd,
            quantity: 3,
            price: price(),
          },
        ],
      },
      metadata: { original: "keep" },
    },
    targetPrice: price("price_target", "prod_other"),
  };
}

// Additional fresh synthetic C3 raw leaves; not an observed provider response.
export function receiptInput() {
  const preparation = input();
  preparation.subscription.customer = "cus_buyer";
  preparation.billingCustomer = {
    id: "cus_buyer",
    object: "customer",
    customer_account: "acct_buyer",
    livemode: false,
    discount: null,
    metadata: { source: "SYNTHETIC_PUBLIC_C3" },
  };
  const attachRequest = {
    preparation,
    apiVersion: "2026-09-30.endive",
    attachKey: "attach:explicit",
    firstDispatchedAt: 1700000001,
  };
  const providerSnapshot = {
    id: "sub_sched_owned",
    object: "subscription_schedule",
    customer_account: "acct_buyer",
    livemode: false,
    customer: "cus_buyer",
    subscription: "sub_original",
    status: "active",
    created: 1700000001,
    released_at: null,
    released_subscription: null,
    canceled_at: null,
    completed_at: null,
    end_behavior: "release",
    billing_mode: { type: "flexible" },
    metadata: { source: "SYNTHETIC_PUBLIC_C3", opaque: "keep" },
    current_phase: { start_date: 1700000000, end_date: 1702592000 },
    default_settings: {
      default_payment_method: null,
      application_fee_percent: null,
      collection_method: "charge_automatically",
      invoice_settings: { days_until_due: null },
    },
    phases: [
      {
        start_date: 1700000000,
        end_date: 1702592000,
        items: [{ price: "price_original", quantity: 3 }],
        proration_behavior: "none",
        metadata: { keep: "phase" },
        discounts: [],
      },
    ],
    future_native_field: { retained: [null, "safe", 1.25] },
  };
  Object.defineProperty(providerSnapshot, "__proto__", {
    value: { retained: true, nested: ["SYNTHETIC", null] },
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return {
    attachRequest,
    actualDispatch: {
      scope: "platform",
      apiVersion: attachRequest.apiVersion,
      method: "POST",
      path: "/v1/subscription_schedules",
      payload: { from_subscription: "sub_original" },
      key: attachRequest.attachKey,
      firstDispatchedAt: attachRequest.firstDispatchedAt,
    },
    providerSnapshot,
  };
}

// Complete C6 raw factory statically extracted from official feature408 fixture.
// No SDK imports/calls or observed provider resources. Invoked only in future authorized consumer.
export function configurationInput() {
  const API_VERSION = "2026-09-30.endive",
    START = Date.parse("2026-01-15T00:00:00Z") / 1000,
    END = Date.parse("2026-02-15T00:00:00Z") / 1000,
    OBSERVED = Date.parse("2026-01-20T00:00:00Z") / 1000;
  function nativePrice(id, product, interval, count) {
    return {
      id,
      object: "price",
      product,
      active: true,
      livemode: false,
      type: "recurring",
      currency: "usd",
      billing_scheme: "per_unit",
      recurring: { interval, interval_count: count, usage_type: "licensed" },
    };
  }

  function nativeDiscount(level, start) {
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

  function native(options = {}) {
    const start = options.start ?? START;
    const end = options.end ?? END;
    const observedAt = options.observedAt ?? OBSERVED;
    const currentPrice = nativePrice(
      "price_original",
      "custom-original",
      options.currentInterval ?? "month",
      options.currentCount ?? 1,
    );
    const targetPrice = {
      ...nativePrice(
        "price_target",
        "custom-target",
        options.targetInterval ?? "month",
        options.targetCount ?? 1,
      ),
      ...options.target,
    };
    const originalItem = {
      id: "si_original",
      object: "subscription_item",
      subscription: "sub_original",
      current_period_start: start,
      current_period_end: end,
      quantity: 3,
      price: currentPrice,
      billing_thresholds: null,
      current_trial: null,
      tax_rates: [],
      discounts: [nativeDiscount("item", start)],
      metadata: { seat: "retained" },
      ...options.item,
    };
    if (options.omitItemCurrentTrial) delete originalItem.current_trial;
    const subscription = {
      id: "sub_original",
      object: "subscription",
      customer: "cus_buyer",
      customer_account: "acct_buyer",
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
      discounts: [nativeDiscount("subscription", start)],
      metadata: { keep: "original" },
      trial_start: start - 100_000,
      trial_end: start - 90_000,
      trial_settings: null,
      items: { object: "list", has_more: false, data: [originalItem] },
      ...options.subscription,
    };
    const billingCustomer = {
      id: "cus_buyer",
      object: "customer",
      customer_account: "acct_buyer",
      livemode: false,
      discount: null,
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
          discount: "di_subscription",
          coupon: "custom-subscription-offer",
          promotion_code: null,
        },
      ],
      ...options.phase,
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
    return {
      subscription,
      targetPrice,
      billingCustomer,
      expected,
      schedule,
      observedAt,
    };
  }
  const f = native(),
    preparation = {
      subscription: f.subscription,
      targetPrice: f.targetPrice,
      billingCustomer: f.billingCustomer,
      expected: f.expected,
      key: "renewal:logical-original",
    };
  const attachRequest = {
    preparation: structuredClone(preparation),
    apiVersion: API_VERSION,
    attachKey: "renewal:attach-original",
    firstDispatchedAt: f.observedAt - 60,
  };
  const attachReceipt = {
    attachRequest,
    actualDispatch: {
      scope: "platform",
      apiVersion: API_VERSION,
      method: "POST",
      path: "/v1/subscription_schedules",
      payload: { from_subscription: "sub_original" },
      key: attachRequest.attachKey,
      firstDispatchedAt: attachRequest.firstDispatchedAt,
    },
    providerSnapshot: structuredClone(f.schedule),
  };
  return {
    preparation,
    attachReceipt,
    freshSubscription: {
      ...structuredClone(f.subscription),
      schedule: f.schedule.id,
    },
    targetPrice: structuredClone(f.targetPrice),
    billingCustomer: structuredClone(f.billingCustomer),
    schedule: structuredClone(f.schedule),
    apiVersion: API_VERSION,
    observedAt: f.observedAt,
    firstDispatchedAt: f.observedAt,
    configureKey: "renewal:configure-original",
  };
}
// Fixed expected normalized payload for this exact declared fixture. No SDK result is an oracle input.
export function configurationPayload(raw) {
  const expected = raw.preparation.expected,
    item = (price) => ({
      tax_rates: "",
      price,
      quantity: 3,
      discounts: [{ discount: "di_item" }],
    }),
    discounts = [{ discount: "di_subscription" }];
  return {
    end_behavior: "release",
    proration_behavior: "none",
    phases: [
      {
        default_tax_rates: "",
        start_date: expected.periodStart,
        end_date: expected.periodEnd,
        currency: "usd",
        proration_behavior: "create_prorations",
        items: [item("price_original")],
        discounts: structuredClone(discounts),
      },
      {
        default_tax_rates: "",
        start_date: expected.periodEnd,
        currency: "usd",
        proration_behavior: "none",
        billing_cycle_anchor: "automatic",
        duration: { interval: "month", interval_count: 1 },
        items: [item("price_target")],
        discounts: structuredClone(discounts),
      },
    ],
  };
}

// Fresh declared C9 raw leaves. No SDK import/result is an oracle input.
// Complete synthetic response body intentionally does NOT prove requested application.
export function configurationReceiptInput() {
  const configuration = configurationInput(),
    providerSnapshot = structuredClone(configuration.schedule);
  providerSnapshot.phases = [
    { observed: "SYNTHETIC_DIFFERENT_RESPONSE_NOT_APPLICATION_PROOF" },
  ];
  providerSnapshot.future_native_field = {
    retained: [null, "SYNTHETIC_PUBLIC_C9", 1.25],
  };
  for (const body of [providerSnapshot, providerSnapshot.default_settings])
    Object.defineProperty(body, "__proto__", {
      value: { retained: true, nested: ["SYNTHETIC", null] },
      enumerable: true,
      writable: true,
      configurable: true,
    });
  return {
    configuration,
    actualDispatch: {
      scope: "platform",
      apiVersion: configuration.apiVersion,
      method: "POST",
      path: "/v1/subscription_schedules/sub_sched_owned",
      payload: configurationPayload(configuration),
      key: configuration.configureKey,
      firstDispatchedAt: configuration.firstDispatchedAt,
    },
    providerSnapshot,
    transport: { status: 200, requestId: "req_SYNTHETIC_087" },
  };
}
