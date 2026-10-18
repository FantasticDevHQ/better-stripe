import { fixture as sourceFixture } from "../paymentSource/resolver.fixtures.js";
import { prepareUsageRecord } from "./records.js";
export function fixture() {
  const f = sourceFixture();
  const scope = {
    stripeAccountId: "acct_platform",
    customerAccount: "acct_customer",
    meterId: "mtr_calls",
    livemode: false,
  };
  const period = { start: 600, end: 1200 };
  const binding = prepareUsageRecord({
    scope,
    binding: {
      stripeCustomerId: "cus_buyer",
      stripePriceId: "price_original",
      eventName: "calls",
      plan: {
        key: "calls",
        version: "v1",
        model: "pay_as_you_go",
        unit: { name: "call", precision: 0 },
        rate: { currency: "usd", unitAmountDecimal: "2" },
      },
    },
    sourceEventId: "proof",
    quantity: "0",
    occurredAt: 600,
  }).binding;
  const meter = {
    id: "mtr_calls",
    livemode: false,
    status: "active",
    event_name: "calls",
    default_aggregation: { formula: "sum" },
    customer_mapping: {
      type: "by_id",
      event_payload_key: "stripe_customer_id",
    },
    value_settings: { event_payload_key: "value" },
    event_time_window: null,
  };
  const price = {
    id: "price_original",
    active: true,
    livemode: false,
    currency: "usd",
    type: "recurring",
    product: "prod_original",
    lookup_key: "calls",
    billing_scheme: "per_unit",
    unit_amount_decimal: "2",
    transform_quantity: null,
    recurring: {
      interval: "month",
      interval_count: 1,
      usage_type: "metered",
      meter: "mtr_calls",
    },
  };
  f.extra.set("/v1/account", { id: "acct_platform" });
  f.extra.set("/v1/balance", { livemode: false });
  f.extra.set("/v1/billing/meters/mtr_calls", meter);
  f.extra.set("/v1/customers/acct_customer", {
    id: "cus_buyer",
    customer_account: "acct_customer",
    livemode: false,
  });
  f.extra.set("/v1/prices/price_original", price);
  Object.assign(f.payment, { customer: "cus_buyer" });
  Object.assign(f.payment.latest_charge, {
    customer: "cus_buyer",
    refunded: false,
  });
  Object.assign(f.subscription, { customer: "cus_buyer" });
  Object.assign(f.line, {
    period,
    quantity: null,
    quantity_decimal: "500",
    pretax_credit_amounts: [],
  });
  Object.assign(f.invoice, {
    customer: "cus_buyer",
    status_transitions: { finalized_at: 1200 },
    lines: { data: [f.line], has_more: false },
  });
  const input = {
    scope,
    binding,
    subscription: {
      subscriptionId: "sub_source",
      subscriptionItemId: "si_source",
      stripePriceId: "price_original",
      period,
      interval: "month" as const,
    },
    period,
    invoiceId: "in_source",
    paymentIntentId: "pi_source",
    gross: 1000,
  };
  return { ...f, meter, price, input };
}
