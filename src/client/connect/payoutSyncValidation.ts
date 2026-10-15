import type Stripe from "stripe";
import type { Infer } from "convex/values";
import type { snapshot } from "../../component/payoutSync/validators.js";
import {
  validateIdentity,
  validateSnapshot,
} from "../../component/payoutSync/helpers.js";
export type PayoutSyncScope =
  { type: "connected"; accountId: string } | { type: "platform" };
export function payoutAccount(scope: PayoutSyncScope) {
  if (scope?.type === "platform" && Object.keys(scope).length === 1)
    return "platform";
  if (
    scope?.type === "connected" &&
    Object.keys(scope).length === 2 &&
    typeof scope.accountId === "string" &&
    /^acct_[A-Za-z0-9_]+$/.test(scope.accountId)
  )
    return scope.accountId;
  throw new Error("Payout synchronization scope must be explicit.");
}
/** Status observations do not establish funding maturity or payout eligibility. */
export function payoutSnapshot(
  p: Stripe.Payout,
  args: { stripePayoutId: string; accountId: string },
): Infer<typeof snapshot> {
  validateIdentity(args);
  if (!p || typeof p !== "object")
    throw new Error("Provider payout response is unavailable.");
  if (p.id !== args.stripePayoutId)
    throw new Error("Provider payout identity does not match.");
  if (
    (p.status !== "pending" &&
      p.status !== "paid" &&
      p.status !== "failed" &&
      p.status !== "canceled" &&
      p.status !== "in_transit") ||
    typeof p.automatic !== "boolean" ||
    !["standard", "instant"].includes(p.method)
  )
    throw new Error("Provider payout status or method is unsupported.");
  if (
    !Number.isSafeInteger(p.arrival_date) ||
    p.arrival_date < 0 ||
    !Number.isSafeInteger(p.arrival_date * 1000) ||
    p.arrival_date * 1000 > 8640000000000000
  )
    throw new Error("Invalid provider payout arrival date.");
  if (
    (p.failure_code != null && typeof p.failure_code !== "string") ||
    (p.failure_message != null && typeof p.failure_message !== "string")
  )
    throw new Error("Invalid provider payout failure detail.");
  const metadata = p.metadata ?? {};
  if (
    typeof metadata !== "object" ||
    Array.isArray(metadata) ||
    Object.values(metadata).some((v) => typeof v !== "string")
  )
    throw new Error("Invalid provider payout metadata.");
  const result: Infer<typeof snapshot> = {
    ...args,
    amount: p.amount,
    currency: p.currency,
    status: p.status,
    arrivalDate: new Date(p.arrival_date * 1000).toISOString(),
    method: p.method,
    failureCode: p.failure_code ?? undefined,
    failureMessage: p.failure_message ?? undefined,
    metadata,
  };
  validateSnapshot(result);
  return result;
}
