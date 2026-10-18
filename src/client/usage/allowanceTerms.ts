import { z } from "zod";
import { prepareUsageRecord, type PreparedUsageRecord } from "./records.js";
import { parseUsageQuantity } from "./contracts.js";
import { decimalFromScaled } from "./summary.js";
import type { UsageSubscriptionBinding } from "./boundaries.js";
export type UsageAllowanceBinding = Pick<
  PreparedUsageRecord,
  "scope" | "binding"
> & {
  subscription: UsageSubscriptionBinding;
};
const seconds = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const subscriptionSchema = z.strictObject({
  subscriptionId: z.string().regex(/^sub_[a-zA-Z0-9]+$/),
  subscriptionItemId: z.string().regex(/^si_[a-zA-Z0-9]+$/),
  stripePriceId: z.string().regex(/^price_[a-zA-Z0-9]+$/),
  period: z.strictObject({ start: seconds, end: seconds }),
  interval: z.literal("month"),
});
export const usageLimitPolicySchema = z.strictObject({
  reset: z.literal("billing_period"),
  rollover: z.literal("none"),
  entitled: z.boolean(),
  overage: z.enum(["allow", "reject"]),
  limit: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("none") }),
    z.strictObject({ mode: z.enum(["soft", "hard"]), quantity: z.string() }),
  ]),
});
export type UsageLimitPolicy = z.infer<typeof usageLimitPolicySchema>;
export type UsageAllowanceStatus = {
  revision: number;
  observedAt: number;
  period: UsageSubscriptionBinding["period"];
  accepting: boolean;
  policy: UsageLimitPolicy;
  consumedQuantity: string;
  reservedQuantity: string;
  includedQuantity: string;
  remainingIncludedQuantity: string;
  billableOverageQuantity: string;
  softLimitReached: boolean;
  hardLimitRemainingQuantity: string | null;
  committedEstimate: { amountDecimal: string; currency: string };
  projectedEstimate: { amountDecimal: string; currency: string };
  cashCollection: "none";
};
export function allowanceBinding(input: unknown): UsageAllowanceBinding {
  const raw = z
    .strictObject({
      scope: z.unknown(),
      binding: z.unknown(),
      subscription: subscriptionSchema,
    })
    .parse(input);
  const event = prepareUsageRecord({
    scope: raw.scope,
    binding: raw.binding,
    sourceEventId: "validation",
    quantity: "0",
    occurredAt: 0,
  });
  if (event.binding.plan.model === "prepaid")
    throw new Error("Use payment-backed prepaid credit accounting");
  if (
    raw.subscription.period.end <= raw.subscription.period.start ||
    raw.subscription.stripePriceId !== event.binding.stripePriceId
  )
    throw new Error("Allowance subscription period/price mismatch");
  return {
    scope: event.scope,
    binding: event.binding,
    subscription: raw.subscription,
  };
}
export function limitPolicy(
  input: unknown,
  binding: UsageAllowanceBinding,
): UsageLimitPolicy {
  const policy = usageLimitPolicySchema.parse(input),
    precision = binding.binding.plan.unit.precision;
  if (policy.limit.mode !== "none")
    policy.limit.quantity = parseUsageQuantity(
      policy.limit.quantity,
      precision,
    ).quantity;
  if (
    binding.binding.plan.model === "pay_as_you_go" &&
    policy.overage === "reject"
  )
    throw new Error(
      "Pay-as-you-go requires an explicit usage cap instead of an included allowance",
    );
  return policy;
}
export function allowanceStatus(
  binding: UsageAllowanceBinding,
  policy: UsageLimitPolicy,
  row: { consumed: string; reserved: string; revision: number },
  observedAt: number,
): UsageAllowanceStatus {
  const plan = binding.binding.plan,
    precision = plan.unit.precision;
  const consumed = BigInt(row.consumed),
    reserved = BigInt(row.reserved),
    total = consumed + reserved;
  const included =
    plan.model === "included_overage"
      ? BigInt(
          parseUsageQuantity(plan.includedQuantity, precision).scaledQuantity,
        )
      : 0n;
  const overage = (quantity: bigint) =>
    quantity > included ? quantity - included : 0n;
  const quantity = (value: bigint) => decimalFromScaled(value, precision);
  const cost = (value: bigint) => {
    const [whole, fraction = ""] = plan.rate.unitAmountDecimal.split(".");
    return {
      amountDecimal: decimalFromScaled(
        overage(value) * BigInt(whole + fraction),
        precision + fraction.length,
      ),
      currency: plan.rate.currency,
    };
  };
  let hard: bigint | null =
    policy.limit.mode === "hard"
      ? BigInt(
          parseUsageQuantity(policy.limit.quantity, precision).scaledQuantity,
        )
      : null;
  if (policy.overage === "reject")
    hard = hard === null || included < hard ? included : hard;
  return {
    revision: row.revision,
    observedAt,
    period: binding.subscription.period,
    accepting:
      policy.entitled &&
      observedAt >= binding.subscription.period.start &&
      observedAt < binding.subscription.period.end - 60 &&
      (hard === null || total < hard),
    policy,
    consumedQuantity: quantity(consumed),
    reservedQuantity: quantity(reserved),
    includedQuantity: quantity(included),
    remainingIncludedQuantity: quantity(
      included > total ? included - total : 0n,
    ),
    billableOverageQuantity: quantity(overage(consumed)),
    softLimitReached:
      policy.limit.mode === "soft" &&
      total >=
        BigInt(
          parseUsageQuantity(policy.limit.quantity, precision).scaledQuantity,
        ),
    hardLimitRemainingQuantity:
      hard === null ? null : quantity(hard > total ? hard - total : 0n),
    committedEstimate: cost(consumed),
    projectedEstimate: cost(total),
    cashCollection: "none",
  };
}

export type UsageAllowanceReconciliation = {
  status: "matched" | "held";
  reason: string;
  consumedScaledQuantity: string;
  reservedScaledQuantity: string;
  acceptedScaledQuantity: string;
  repaired: false;
};
