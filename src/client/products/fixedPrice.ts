import type Stripe from "stripe";

/** The legacy fixed-price mirror cannot express metered or tiered amounts. */
export function isFixedPrice(price: Stripe.Price): boolean {
  return (
    price.recurring?.usage_type !== "metered" &&
    price.billing_scheme !== "tiered" &&
    price.transform_quantity == null &&
    typeof price.unit_amount === "number" &&
    Number.isSafeInteger(price.unit_amount) &&
    price.unit_amount >= 0
  );
}
