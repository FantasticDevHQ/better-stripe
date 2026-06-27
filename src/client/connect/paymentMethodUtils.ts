import type Stripe from "stripe";

import { resolveOwnerAccount } from "../utils/owner.js";

/**
 * Return the owner of a payment method, checking V2 `customer_account` first,
 * then falling back to the legacy `customer` field.
 */
export function getPaymentMethodOwner(pm: Stripe.PaymentMethod): string | null {
  return resolveOwnerAccount(pm);
}

/**
 * Extract a normalized card object from a payment method.
 * Returns undefined if the method has no card data.
 */
export function getPaymentMethodCard(method: Stripe.PaymentMethod) {
  if (!method.card) {
    return undefined;
  }

  return {
    brand: method.card.brand ?? "",
    last4: method.card.last4 ?? "",
    expMonth: method.card.exp_month ?? 0,
    expYear: method.card.exp_year ?? 0,
  };
}
