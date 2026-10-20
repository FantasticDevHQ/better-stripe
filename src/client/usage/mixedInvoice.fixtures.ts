import { fixture } from "./invoiceSale.fixtures.js";
export function mixed() {
  const f = fixture();
  const base = structuredClone(f.line);
  Object.assign(base, {
    id: "il_base",
    amount: 2000,
    quantity: 1,
    quantity_decimal: "1",
    period: { start: 1200, end: 1800 },
  });
  base.parent.subscription_item_details.subscription_item = "si_base";
  base.pricing.price_details.price = "price_base";
  Object.assign(f.invoice, {
    amount_paid: 3000,
    amount_due: 3000,
    total: 3000,
    billing_reason: "subscription_cycle",
  });
  Object.assign(f.payment, { amount: 3000, amount_received: 3000 });
  Object.assign(f.payment.latest_charge, {
    amount: 3000,
    amount_captured: 3000,
  });
  Object.assign(f.payment.latest_charge.balance_transaction, {
    amount: 3000,
    fee: 120,
    net: 2880,
  });
  Object.assign(f.funding, { amount_paid: 3000, amount_requested: 3000 });
  f.extra.set("/v1/prices/price_base", {
    ...f.price,
    id: "price_base",
    unit_amount: 2000,
    unit_amount_decimal: "2000",
    recurring: {
      interval: "month",
      interval_count: 1,
      usage_type: "licensed",
      meter: null,
    },
  });
  f.history.lines.push(base);
  const input = {
    ...f.input,
    gross: 3000,
    fixedPrice: {
      stripePriceId: "price_base",
      subscriptionItemId: "si_base",
      unitAmount: 2000,
    },
  };
  return { ...f, base, input };
}
