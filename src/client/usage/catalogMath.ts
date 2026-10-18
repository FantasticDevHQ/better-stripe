/** Convert minor currency units per whole unit to a native scaled-unit rate. */
export function scaledUsageRate(rate: string, precision: number): string {
  if (
    !Number.isInteger(precision) ||
    precision < 0 ||
    precision > 6 ||
    !/^(0|[1-9]\d{0,11})(\.\d{1,12})?$/.test(rate)
  )
    throw new Error("Unsupported native usage rate");
  const [whole, fraction = ""] = rate.split(".");
  const places = fraction.length + precision;
  const digits = (whole + fraction).padStart(places + 1, "0");
  const raw = places
    ? `${digits.slice(0, -places)}.${digits.slice(-places)}`
    : digits;
  const [integer, decimal = ""] = raw.split(".");
  const normalized = decimal.replace(/0+$/, "");
  if (normalized.length > 12)
    throw new Error("Unsupported native usage rate precision");
  const base = BigInt(integer).toString();
  return normalized ? `${base}.${normalized}` : base;
}
