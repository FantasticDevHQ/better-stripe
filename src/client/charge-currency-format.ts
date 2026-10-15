/** Internal exact renderer. Callers establish units and amount eligibility. */
export function renderCurrencyUnits(
  amount: number,
  currency: string,
  apiDecimals: 0 | 2,
  displayDecimals: 0 | 2,
  locale: string,
): string {
  const scale = 10n ** BigInt(apiDecimals);
  const units = BigInt(Math.abs(amount));
  const whole = units / scale;
  const signedWhole = amount < 0 ? (whole === 0n ? -0 : -whole) : whole;
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: displayDecimals,
    maximumFractionDigits: displayDecimals,
  });
  const digits = new Intl.NumberFormat(locale, { useGrouping: false });
  const fraction = (units % scale).toString().padStart(apiDecimals, "0");
  return formatter
    .formatToParts(signedWhole)
    .map((part) =>
      part.type === "fraction"
        ? [...fraction].map((digit) => digits.format(Number(digit))).join("")
        : part.value,
    )
    .join("");
}
