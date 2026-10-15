/** Stripe charge/Price units. These are not payout or Global Payouts rules. */
import { renderCurrencyUnits } from "./charge-currency-format.js";
const zeroDecimal = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
]);
const unsupportedPrecision = new Set([
  "bhd",
  "clf",
  "iqd",
  "jod",
  "kwd",
  "lyd",
  "omr",
  "tnd",
  "uyw",
]);
const currencyIntl: typeof Intl & {
  supportedValuesOf?: (key: "currency") => string[];
} = Intl;
const knownCurrencies = new Set(
  (currencyIntl.supportedValuesOf?.("currency") ?? []).map((code) =>
    code.toLowerCase(),
  ),
);

export type ChargeCurrencyMetadata = {
  currency: string;
  apiDecimals: 0 | 2;
  displayDecimals: 0 | 2;
};

/** Metadata does not establish account/country/payment-method support. */
export function getChargeCurrencyMetadata(
  currency: string,
): ChargeCurrencyMetadata | null {
  const code = currency.toLowerCase();
  if (!knownCurrencies.has(code) || unsupportedPrecision.has(code)) return null;
  if (zeroDecimal.has(code))
    return { currency: code, apiDecimals: 0, displayDecimals: 0 };
  return {
    currency: code,
    apiDecimals: 2,
    displayDecimals: code === "isk" || code === "ugx" ? 0 : 2,
  };
}

/** Parse a nonnegative ASCII decimal exactly. Invalid input is never rounded. */
export function parseChargeAmount(
  value: string,
  currency: string,
): number | null {
  const metadata = getChargeCurrencyMetadata(currency);
  if (!metadata || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > metadata.displayDecimals) return null;
  const units =
    BigInt(whole) * 10n ** BigInt(metadata.apiDecimals) +
    BigInt(fraction.padEnd(metadata.apiDecimals, "0") || "0");
  return units <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(units) : null;
}

/** Format signed integer charge units without floating-point division. */
export function formatChargeAmount(
  amount: number,
  currency: string,
  locale = "en-US",
): string {
  const metadata = getChargeCurrencyMetadata(currency);
  if (
    !metadata ||
    !Number.isSafeInteger(amount) ||
    (metadata.displayDecimals === 0 &&
      amount % 10 ** metadata.apiDecimals !== 0)
  ) {
    throw new RangeError("Invalid charge amount or unsupported currency");
  }
  return renderCurrencyUnits(
    amount,
    metadata.currency,
    metadata.apiDecimals,
    metadata.displayDecimals,
    locale,
  );
}
