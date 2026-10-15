import { getChargeCurrencyMetadata } from "../../client/charge-currency.js";
import { formatPrice } from "../lib/price-helpers.js";

export type RefundPreviewGroup = {
  currency: string;
  status: string;
  /** Loaded rows only. Null means unknown/invalid units or an unsafe sum. */
  amount: number | null;
  count: number;
};

function isRefundAmount(amount: number, currency: string): boolean {
  return (
    Number.isSafeInteger(amount) &&
    amount >= 0 &&
    getChargeCurrencyMetadata(currency) !== null
  );
}

/** Observed refund units, including fractional ISK/UGX amounts; not input eligibility. */
export function formatRefundAmount(
  amount: number,
  currency: string,
  locale = "en-US",
): string | null {
  return isRefundAmount(amount, currency)
    ? formatPrice(amount, currency, locale)
    : null;
}

/** Group only the supplied preview, preserving provider status and currency. */
export function groupRefundPreview(
  rows: readonly { amount: number; currency: string; status: string }[],
): RefundPreviewGroup[] {
  const groups = new Map<string, RefundPreviewGroup>();
  for (const row of rows) {
    const currency = row.currency.toLowerCase();
    const key = JSON.stringify([currency, row.status]);
    const group = groups.get(key) ?? {
      currency,
      status: row.status,
      amount: 0,
      count: 0,
    };
    group.count++;
    if (group.amount === null || !isRefundAmount(row.amount, currency))
      group.amount = null;
    else {
      const sum = BigInt(group.amount) + BigInt(row.amount);
      group.amount =
        sum <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(sum) : null;
    }
    groups.set(key, group);
  }
  return [...groups.values()];
}
