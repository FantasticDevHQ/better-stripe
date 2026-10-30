// Independent fixed TEST request facts, declared from immutable intent before any SDK call.
import { INTENT as I } from "./f25.mjs";
const freeze = (x) => {
  if (x && typeof x === "object") {
    for (const v of Object.values(x)) freeze(v);
    Object.freeze(x);
  }
  return x;
};
// Exact selected phase settings: empty retained tax rates emit empty strings;
// inherited null phase PM/settings remain absent, forever redemptions retain IDs.
export const declaredConfigureWire = freeze({
  scope: "platform",
  apiVersion: I.API_VERSION,
  method: "POST",
  path: "/v1/subscription_schedules/" + I.SCHEDULE,
  key: I.CONFIGURE_KEY,
  firstDispatchedAt: I.CONFIGURE_FIRST_DISPATCHED_AT,
  payload: {
    end_behavior: "release",
    proration_behavior: "none",
    phases: [
      {
        default_tax_rates: "",
        start_date: I.T0,
        end_date: I.T1,
        currency: "usd",
        proration_behavior: "create_prorations",
        items: [
          {
            tax_rates: "",
            price: I.PRICE_ORIGINAL,
            quantity: 1,
            discounts: [{ discount: I.DISCOUNT_S_ITEM }],
          },
        ],
        discounts: [{ discount: I.DISCOUNT_S_SUB }],
      },
      {
        default_tax_rates: "",
        start_date: I.T1,
        currency: "usd",
        proration_behavior: "none",
        billing_cycle_anchor: "automatic",
        duration: { interval: "month", interval_count: 1 },
        items: [
          {
            tax_rates: "",
            price: I.PRICE_TARGET,
            quantity: 1,
            discounts: [{ discount: I.DISCOUNT_S_ITEM }],
          },
        ],
        discounts: [{ discount: I.DISCOUNT_S_SUB }],
      },
    ],
  },
});
