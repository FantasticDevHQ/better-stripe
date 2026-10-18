export const meter = {
  scope: {
    stripeAccountId: "acct_platform",
    customerAccount: "acct_buyer",
    meterId: "mtr_calls",
    livemode: false,
  },
  binding: {
    stripeCustomerId: "cus_buyer",
    stripePriceId: "price_calls",
    eventName: "calls",
    plan: {
      key: "calls",
      version: "v1",
      model: "included_overage" as const,
      unit: { name: "call", precision: 0 },
      rate: { currency: "usd", unitAmountDecimal: "2" },
      includedQuantity: "10",
      reset: "billing_period" as const,
    },
  },
};
export const request = {
  requestId: "signup1",
  meters: [meter],
  fixedPriceIds: ["price_base"],
  collection: { method: "send_invoice" as const, daysUntilDue: 30 },
};
export function nativeSubscription() {
  return {
    id: "sub_calls",
    livemode: false,
    customer_account: "acct_buyer",
    customer: "cus_buyer",
    status: "active",
    currency: "usd",
    billing_mode: { type: "flexible" },
    cancel_at_period_end: false,
    cancel_at: null,
    items: {
      data: [
        {
          id: "si_calls",
          current_period_start: 600,
          current_period_end: 1200,
          quantity: null,
          price: {
            id: "price_calls",
            currency: "usd",
            recurring: {
              interval: "month",
              interval_count: 1,
              usage_type: "metered",
              meter: "mtr_calls",
            },
            unit_amount_decimal: null,
          },
        },
        {
          id: "si_base",
          current_period_start: 600,
          current_period_end: 1200,
          quantity: 1,
          price: {
            id: "price_base",
            currency: "usd",
            recurring: {
              interval: "month",
              interval_count: 1,
              usage_type: "licensed",
            },
            unit_amount_decimal: "1000",
          },
        },
      ],
      has_more: false,
    },
  };
}
