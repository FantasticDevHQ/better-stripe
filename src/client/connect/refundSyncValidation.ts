import type Stripe from "stripe";
import type { Infer } from "convex/values";
import type { snapshot } from "../../component/refundSync/validators.js";
import { validateSnapshot } from "../../component/refundSync/helpers.js";

export type RefundSyncScope =
  { type: "platform" } | { type: "connected"; accountId: string };

/** The host authorizes this API namespace; metadata never selects it. */
export function refundApiContext(scope: RefundSyncScope) {
  if (scope?.type === "platform" && Object.keys(scope).length === 1)
    return "platform";
  if (
    scope?.type === "connected" &&
    Object.keys(scope).length === 2 &&
    typeof scope.accountId === "string" &&
    /^acct_[A-Za-z0-9_]{1,250}$/.test(scope.accountId)
  )
    return scope.accountId;
  throw new Error("Refund synchronization scope must be explicit.");
}

function originalId(
  value: string | { id: string; object: string } | null,
  kind: "charge" | "payment_intent",
) {
  if (typeof value === "string") return value;
  if (value && value.object === kind && typeof value.id === "string")
    return value.id;
  throw new Error("Provider refund original payment identity is unavailable.");
}

function refundReason(
  value: Stripe.Refund.Reason | null,
): Infer<typeof snapshot>["reason"] {
  switch (value) {
    case null:
      return undefined;
    case "duplicate":
      return "duplicate";
    case "fraudulent":
      return "fraudulent";
    case "requested_by_customer":
      return "requested_by_customer";
    case "expired_uncaptured_charge":
      return "expired_uncaptured_charge";
    default:
      throw new Error("Provider refund reason is invalid.");
  }
}

/** A current provider observation can legitimately move back to requires_action. */
export function refundSnapshot(
  r: Stripe.Refund,
  stripeRefundId: string,
): Infer<typeof snapshot> {
  if (!r || r.object !== "refund" || r.id !== stripeRefundId)
    throw new Error("Provider refund identity does not match.");
  if (
    !["pending", "requires_action", "succeeded", "failed", "canceled"].includes(
      r.status ?? "",
    )
  )
    throw new Error("Provider refund status is unavailable.");
  const reason = refundReason(r.reason);
  if (r.failure_reason != null && typeof r.failure_reason !== "string")
    throw new Error("Provider refund failure detail is invalid.");
  const metadata = r.metadata === null ? {} : r.metadata;
  if (
    !metadata ||
    typeof metadata !== "object" ||
    Array.isArray(metadata) ||
    Object.values(metadata).some((value) => typeof value !== "string")
  )
    throw new Error("Provider refund metadata is invalid.");
  const row: Infer<typeof snapshot> = {
    stripeRefundId: r.id,
    stripePaymentIntentId: originalId(r.payment_intent, "payment_intent"),
    stripeChargeId: originalId(r.charge, "charge"),
    amount: r.amount,
    currency: r.currency,
    status: r.status as Infer<typeof snapshot>["status"],
    ...(reason === undefined ? {} : { reason }),
    ...(r.failure_reason == null ? {} : { failureReason: r.failure_reason }),
    metadata,
  };
  validateSnapshot(row);
  return row;
}

/** The charge's original destination is independent of the caller's API namespace. */
export function refundChargeMerchant(
  charge: Stripe.Charge,
  row: Infer<typeof snapshot>,
) {
  if (
    !charge ||
    charge.object !== "charge" ||
    charge.id !== row.stripeChargeId ||
    originalId(charge.payment_intent, "payment_intent") !==
      row.stripePaymentIntentId ||
    charge.currency !== row.currency ||
    !Number.isSafeInteger(charge.amount) ||
    charge.amount < row.amount
  )
    throw new Error("Original refund charge proof does not match.");
  const destination = charge.transfer_data?.destination;
  const account =
    typeof destination === "string"
      ? destination
      : destination?.object === "account"
        ? destination.id
        : undefined;
  if (
    typeof account !== "string" ||
    !/^acct_[A-Za-z0-9_]{1,250}$/.test(account)
  )
    throw new Error("Original refund merchant cannot be qualified.");
  return account;
}
