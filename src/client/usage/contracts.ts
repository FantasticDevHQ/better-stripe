import { z } from "zod";

const unit = z.strictObject({
  name: z.string().min(1).max(100),
  precision: z.number().int().min(0).max(6),
});
const rate = z.strictObject({
  currency: z.string().regex(/^[a-z]{3}$/),
  // Decimal minor currency units per whole billable unit, never a JS float.
  unitAmountDecimal: z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,12})?$/),
});
const common = {
  key: z.string().min(1).max(100),
  version: z.string().min(1).max(100),
  unit,
  rate,
};
const planSchema = z.discriminatedUnion("model", [
  z.strictObject({ ...common, model: z.literal("pay_as_you_go") }),
  z.strictObject({
    ...common,
    model: z.literal("included_overage"),
    includedQuantity: z.string(),
    reset: z.literal("billing_period"),
  }),
  z.strictObject({
    ...common,
    model: z.literal("prepaid"),
    insufficientBalance: z.literal("reject"),
  }),
]);

/** Configuration contracts only. Validating a plan does not enable billing. */
export type UsagePlan = z.infer<typeof planSchema>;
export type UsageBillingModel = UsagePlan["model"];
export type ExactUsageQuantity = {
  quantity: string;
  scaledQuantity: string;
  precision: number;
};

/**
 * Parse a nonnegative decimal quantity without rounding. The shared contract
 * supports 0–6 decimal places and at most 18 scaled digits. A provider adapter
 * must additionally enforce its own supported bounds before accepting usage.
 */
export function parseUsageQuantity(
  value: unknown,
  precision: number,
): ExactUsageQuantity {
  if (!Number.isInteger(precision) || precision < 0 || precision > 6)
    throw new Error("Usage precision must be an integer between 0 and 6");
  if (
    typeof value !== "string" ||
    value.length > 25 ||
    !/^(0|[1-9]\d*)(\.\d+)?$/.test(value)
  )
    throw new Error("Usage quantity must be a nonnegative decimal string");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > precision)
    throw new Error("Usage quantity exceeds configured precision");
  const scaled = BigInt(whole + fraction.padEnd(precision, "0"));
  if (scaled > 999_999_999_999_999_999n)
    throw new Error("Usage quantity exceeds the shared scaled bound");
  const normalizedFraction = fraction.replace(/0+$/, "");
  return {
    quantity: normalizedFraction ? `${whole}.${normalizedFraction}` : whole,
    scaledQuantity: scaled.toString(),
    precision,
  };
}

/** Validate and copy terms; provider provisioning and host authorization are separate. */
export function defineUsagePlan(input: unknown): UsagePlan {
  const plan = planSchema.parse(input);
  if (plan.model === "included_overage")
    parseUsageQuantity(plan.includedQuantity, plan.unit.precision);
  return plan;
}
