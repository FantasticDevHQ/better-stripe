import { prepareRenewalPriceReplacement } from "../../src/client/billing/renewalPriceReplacement.js";
import { renewalSnapshot } from "../../src/client/billing/renewalReplacementSnapshot.js";

// Synthetic provider-shaped reads. These unit fixtures are not provider receipts.
export const API_VERSION = "2026-09-30.endive";
export const stamp = (iso: string) => Date.parse(iso) / 1000;
const START = stamp("2026-01-15T00:00:00Z");
const END = stamp("2026-02-15T00:00:00Z");
const OBSERVED = stamp("2026-01-20T00:00:00Z");

type Patch = Record<string, unknown>;
export type FixtureOptions = {
  start?: number;
  end?: number;
  observedAt?: number;
  currentInterval?: string;
  currentCount?: number;
  targetInterval?: string;
  targetCount?: number;
  subscription?: Patch;
  item?: Patch;
  omitItemCurrentTrial?: boolean;
  phase?: Patch;
  phaseItem?: Patch;
  defaults?: Patch;
  target?: Patch;
};

export function alter<T>(
  value: T,
  path: (string | number)[],
  next: unknown,
): T {
  const result = structuredClone(value);
  let cursor = result as unknown as Record<string | number, unknown>;
  for (const key of path.slice(0, -1))
    cursor = cursor[key] as Record<string | number, unknown>;
  cursor[path[path.length - 1]!] = next;
  return result;
}

const binding = (namespace: string, value: unknown) =>
  `${namespace}:v1:${JSON.stringify(renewalSnapshot(value))}`;

function price(id: string, product: string, interval: string, count: number) {
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

export function fixture(options: FixtureOptions = {}) {
  const start = options.start ?? START;
  const end = options.end ?? END;
  const observedAt = options.observedAt ?? OBSERVED;
  const currentPrice = price(
    "price_original",
    "custom-original",
    options.currentInterval ?? "month",
    options.currentCount ?? 1,
  );
  const targetPrice = {
    ...price(
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
    discounts: [discount("item", start)],
    metadata: { seat: "retained" },
    ...options.item,
  };
  if (options.omitItemCurrentTrial)
    delete (originalItem as Record<string, unknown>).current_trial;
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
    discounts: [discount("subscription", start)],
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
  const prepared = prepareRenewalPriceReplacement({
    subscription,
    targetPrice,
    billingCustomer,
    expected,
    key: "renewal:logical-original",
  });
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
  const unsignedRequest = {
    version: 1,
    stage: "attach",
    scope: "platform",
    apiVersion: API_VERSION,
    logicalBinding: prepared.requestIdentity.binding,
    method: "POST",
    path: "/v1/subscription_schedules",
    payload: { from_subscription: "sub_original" },
    key: "renewal:attach-original",
    firstDispatchedAt: observedAt - 60,
  };
  const attachRequest = {
    ...unsignedRequest,
    requestIdentity: {
      key: unsignedRequest.key,
      binding: binding("renewal-attach", unsignedRequest),
    },
  };
  const unsignedReceipt = {
    version: 1,
    stage: "attached_unconfigured",
    scope: "platform",
    logicalBinding: prepared.requestIdentity.binding,
    request: attachRequest,
    scheduleId: schedule.id,
    subscriptionId: "sub_original",
    customerAccountId: "acct_buyer",
    livemode: false,
    providerSnapshot: structuredClone(schedule),
  };
  const attachReceipt = {
    ...unsignedReceipt,
    binding: binding("renewal-attach-receipt", unsignedReceipt),
  };
  const preflightInput = {
    prepared,
    freshSubscription: structuredClone(subscription),
    targetPrice: structuredClone(targetPrice),
    billingCustomer,
    apiVersion: API_VERSION,
    observedAt,
  };
  const configureInput = {
    prepared,
    attachReceipt,
    freshSubscription: {
      ...structuredClone(subscription),
      schedule: schedule.id,
    },
    targetPrice: structuredClone(targetPrice),
    billingCustomer,
    schedule: structuredClone(schedule),
    apiVersion: API_VERSION,
    configureKey: "renewal:configure-original",
    firstDispatchedAt: observedAt,
    observedAt,
  };
  return {
    prepared,
    preflightInput,
    configureInput,
    subscription,
    originalItem,
    targetPrice,
    billingCustomer,
    schedule,
    attachRequest,
    attachReceipt,
  };
}
