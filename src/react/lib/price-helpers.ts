/**
 * Price formatting and filtering utilities.
 */
import {
  formatChargeAmount,
  getChargeCurrencyMetadata,
} from "../../client/charge-currency.js";
import { renderCurrencyUnits } from "../../client/charge-currency-format.js";

type PriceLike = {
  unitAmount?: number | null;
  currency: string;
  interval?: string | null;
  intervalCount?: number | null;
  type: string;
  active: boolean;
};

/**
 * Legacy display helper for observed ordinary account/charge units.
 * Preserves fractional ISK/UGX balances; does not validate charge eligibility.
 * e.g. 2000, 'usd' → '$20.00'
 */
export function formatPrice(
  amount: number,
  currency: string,
  locale = "en-US",
): string {
  const metadata = getChargeCurrencyMetadata(currency);
  if (!metadata || !Number.isSafeInteger(amount))
    throw new RangeError("Invalid amount or unsupported currency");
  const displayDecimals =
    amount % 10 ** metadata.apiDecimals === 0
      ? metadata.displayDecimals
      : metadata.apiDecimals;
  return renderCurrencyUnits(
    amount,
    metadata.currency,
    metadata.apiDecimals,
    displayDecimals,
    locale,
  );
}

/**
 * Format a price with its billing interval.
 * e.g. '$20.00/month' or '$200.00/year'
 */
export function formatPriceWithInterval(
  price: PriceLike,
  locale = "en-US",
  customPriceLabel = "Custom price",
): string {
  if (price.unitAmount == null) return customPriceLabel;
  const amount = formatChargeAmount(price.unitAmount, price.currency, locale);
  if (price.type === "one_time" || !price.interval) {
    return amount;
  }
  const count = price.intervalCount ?? 1;
  if (count === 1) {
    return `${amount}/${price.interval}`;
  }
  return `${amount} every ${count} ${price.interval}s`;
}

/**
 * Filter prices by billing interval.
 */
export function filterPricesByInterval<T extends PriceLike>(
  prices: T[] | undefined | null,
  interval: "month" | "year" | "week" | "day",
): T[] {
  if (!prices) return [];
  return prices.filter((p) => p.interval === interval && p.active);
}

/**
 * Sort prices by unit amount ascending.
 */
export function sortPricesByAmount<T extends PriceLike>(
  prices: T[] | undefined | null,
): T[] {
  if (!prices) return [];
  return [...prices].sort((a, b) => (a.unitAmount ?? 0) - (b.unitAmount ?? 0));
}
