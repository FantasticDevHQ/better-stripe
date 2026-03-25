/**
 * Price formatting and filtering utilities.
 */

type PriceLike = {
  unitAmount?: number | null;
  currency: string;
  interval?: string | null;
  intervalCount?: number | null;
  type: string;
  active: boolean;
};

/**
 * Format a price amount in cents to a display string.
 * e.g. 2000, 'usd' → '$20.00'
 */
export function formatPrice(
  amountInCents: number,
  currency: string,
  locale = 'en-US',
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(amountInCents / 100);
}

/**
 * Format a price with its billing interval.
 * e.g. '$20.00/month' or '$200.00/year'
 */
export function formatPriceWithInterval(
  price: PriceLike,
  locale = 'en-US',
): string {
  const amount = formatPrice(price.unitAmount ?? 0, price.currency, locale);
  if (price.type === 'one_time' || !price.interval) {
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
  interval: 'month' | 'year' | 'week' | 'day',
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
