import { formatPrice } from "./price-helpers.js";

/** Display observed ordinary Stripe balances without implying payout eligibility.
 * Unknown precision remains explicit raw units rather than guessing a divisor.
 */
export function formatPayoutAmount(
  amount: number,
  currency: string,
  locale = "en-US",
): string {
  try {
    return formatPrice(amount, currency, locale);
  } catch {
    return `${currency.toUpperCase()} ${amount} minor units (display unavailable)`;
  }
}
