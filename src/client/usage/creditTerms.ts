import { z } from "zod";
import {
  prepareUsageRecord,
  type PreparedUsageRecord,
  type UsageScope,
} from "./records.js";
import { parseUsageQuantity, type UsagePlan } from "./contracts.js";
export class UsageCreditError extends Error {
  constructor(
    readonly code:
      | "unsupported_scope"
      | "incompatible_terms"
      | "insufficient_credits"
      | "reconciliation_required"
      | "unknown_create_outcome"
      | "provider_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "UsageCreditError";
  }
}
export type UsageCreditBinding = {
  scope: UsageScope;
  binding: Omit<PreparedUsageRecord["binding"], "apiVersion"> & {
    apiVersion?: string;
  };
};
export type UsageCreditPurchaseOptions = UsageCreditBinding & {
  purchaseId: string;
  quantity: string;
  ownership: "issuer";
  rollover: "retain_original_terms";
  expiresAt?: number;
};
const options = z.strictObject({
  scope: z.unknown(),
  binding: z.unknown(),
  purchaseId: z.string().min(1).max(100),
  quantity: z.string().max(25),
  ownership: z.literal("issuer"),
  rollover: z.literal("retain_original_terms"),
  expiresAt: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .optional(),
});
/** Quantity accounting is price-specific. No monetary wallet or currency conversion. */
export function creditCost(plan: UsagePlan, scaledQuantity: string): number {
  if (plan.model !== "prepaid" || !/^\d{1,18}$/.test(scaledQuantity))
    throw new UsageCreditError(
      "incompatible_terms",
      "Original prepaid terms required",
    );
  const [whole, fraction = ""] = plan.rate.unitAmountDecimal.split(".");
  const numerator = BigInt(whole + fraction) * BigInt(scaledQuantity);
  const denominator = 10n ** BigInt(fraction.length + plan.unit.precision);
  if (numerator <= 0n || numerator % denominator !== 0n)
    throw new UsageCreditError(
      "incompatible_terms",
      "Prepaid consumption requires whole minor currency units",
    );
  const amount = numerator / denominator;
  if (amount > 99999999n)
    throw new UsageCreditError(
      "incompatible_terms",
      "Prepaid backing exceeds native payment bound",
    );
  return Number(amount);
}
export function creditBinding(input: UsageCreditBinding) {
  const { scope, binding } = prepareUsageRecord({
    scope: input.scope,
    binding: input.binding,
    sourceEventId: "credit",
    quantity: "0",
    occurredAt: 0,
  });
  if (binding.plan.model !== "prepaid")
    throw new UsageCreditError("incompatible_terms", "Prepaid plan required");
  return { scope, binding };
}
export function creditPurchaseTerms(input: unknown) {
  if (
    input &&
    typeof input === "object" &&
    "ownership" in input &&
    input.ownership !== "issuer"
  )
    throw new UsageCreditError(
      "unsupported_scope",
      "Native credits support only the issuer's own services",
    );
  const parsed = options.parse(input);
  const original = creditBinding(parsed as UsageCreditPurchaseOptions);
  const quantity = parseUsageQuantity(
    parsed.quantity,
    original.binding.plan.unit.precision,
  );
  return {
    ...parsed,
    ...original,
    quantity: quantity.quantity,
    scaledQuantity: quantity.scaledQuantity,
    amount: creditCost(original.binding.plan, quantity.scaledQuantity),
  };
}
export type UsageCreditPurchaseTerms = ReturnType<typeof creditPurchaseTerms>;
export type UsageCreditBalance = {
  availableQuantity: string;
  reservedQuantity: string;
  consumedQuantity: string;
  expiredQuantity: string;
  frozenQuantity: string;
  precision: number;
  currency: string;
  unit: string;
  status: "available" | "held";
  cashCollection: "none";
};
export type UsageCreditPurchase = {
  purchaseId: string;
  state: "pending" | "ready" | "frozen" | "canceled";
  paymentIntentId: string | null;
  creditGrantId: string | null;
  quantity: string;
  amount: number;
  currency: string;
};

export class UsageCreditRecoveryError extends UsageCreditError {
  constructor(readonly reason: "payment_refunded" | "payment_disputed") {
    super(
      "reconciliation_required",
      "Credit payment refund or dispute requires recovery",
    );
  }
}
