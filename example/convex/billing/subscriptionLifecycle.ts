export function trialEndFromDateInput(value: string): "now" | number {
  if (value === "now") return "now";

  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(timestamp)) {
    throw new Error("Trial end must be a valid date or now");
  }

  return Math.floor(timestamp / 1000);
}
