import { getChargeCurrencyMetadata } from "../../client/charge-currency.js";
/** Native metered rates/estimates use minor currency decimals. Preserve fractional cents and large quantities. */
export function formatUsageEstimate(
  amountDecimal: string,
  currency: string,
): string | null {
  const metadata = getChargeCurrencyMetadata(currency);
  if (!metadata || !/^\d+(?:\.\d+)?$/.test(amountDecimal)) return null;
  const [whole, fraction = ""] = amountDecimal.split(".");
  const digits = (whole + fraction).replace(/^0+(?=\d)/, "");
  const scale = metadata.apiDecimals + fraction.length;
  const padded = digits.padStart(scale + 1, "0");
  const major = scale ? padded.slice(0, -scale) : padded;
  let minor = scale ? padded.slice(-scale).replace(/0+$/, "") : "";
  if (metadata.displayDecimals === 0 && minor) return null;
  minor = minor.padEnd(metadata.displayDecimals, "0");
  return `${major}${minor ? "." + minor : ""} ${metadata.currency.toUpperCase()}`;
}

/** Normalize only the visual progress position; keep all visible quantities exact. */
export function allowanceProgress(value: {
  consumedQuantity: string;
  reservedQuantity: string;
  includedQuantity: string;
}): number | null {
  const quantities = [
    value.consumedQuantity,
    value.reservedQuantity,
    value.includedQuantity,
  ];
  if (quantities.some((quantity) => !/^\d{1,18}(?:\.\d{1,6})?$/.test(quantity)))
    return null;
  const [consumed, reserved, included] = quantities.map((quantity) => {
    const [whole, fraction = ""] = quantity.split(".");
    return BigInt(whole + fraction.padEnd(6, "0"));
  });
  if (included === 0n) return null;
  const ratio = ((consumed + reserved) * 10000n) / included;
  return Number(ratio > 10000n ? 10000n : ratio);
}

/** Numeric usage periods can exceed Date's supported display range. */
export function formatUsageTime(seconds: number): string {
  const value = new Date(seconds * 1000);
  return Number.isFinite(value.getTime())
    ? value.toISOString()
    : "Time unavailable";
}
