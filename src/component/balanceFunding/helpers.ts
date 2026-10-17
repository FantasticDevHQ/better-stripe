import type { Infer } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import type {
  operationDoc,
  preparationDoc,
  operationRefFields,
} from "./schema.js";
type Scope = { accountId: string; scopeKey: string };
type Ref = {
  [K in keyof typeof operationRefFields]: Infer<(typeof operationRefFields)[K]>;
};
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export const fingerprint = (value: unknown) => JSON.stringify(canonical(value));
export const same = (a: unknown, b: unknown) =>
  fingerprint(a) === fingerprint(b);
export function text(value: string) {
  if (!value.trim() || value.length > 200)
    throw new Error("Invalid balance funding identity.");
}
export function validateScope(scope: Scope) {
  text(scope.accountId);
  text(scope.scopeKey);
}
export function integer(value: number, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new Error("Invalid balance funding version or time.");
}
export const unavailable = (
  reason: "identity_changed" | "revision_changed" | "scope_busy",
) => ({ status: "conflict" as const, reason, retryable: false as const });
export async function readPreparation(
  ctx: QueryCtx | MutationCtx,
  args: Scope & { preparationId: Infer<typeof preparationDoc>["_id"] },
) {
  validateScope(args);
  const value = await ctx.db.get(
    "balanceFundingPreparations",
    args.preparationId,
  );
  if (
    value &&
    (value.accountId !== args.accountId || value.scopeKey !== args.scopeKey)
  )
    throw new Error("Balance funding scope identity does not match.");
  return value;
}
export async function readOperation(ctx: QueryCtx | MutationCtx, args: Ref) {
  validateScope(args);
  integer(args.version, 1);
  const value = await ctx.db.get("balanceFundingOperations", args.operationId);
  if (
    value &&
    (value.accountId !== args.accountId ||
      value.scopeKey !== args.scopeKey ||
      value.version !== args.version)
  )
    throw new Error("Balance funding operation identity does not match.");
  return value;
}
export function ref(value: Infer<typeof operationDoc>) {
  return {
    accountId: value.accountId,
    scopeKey: value.scopeKey,
    operationId: value._id,
    version: value.version,
  };
}
export function validateOriginal(value: {
  customerAccount: string;
  stripeSubscriptionId: string;
  previousPaymentMethodId: string | null;
  previousPaymentMethodTypes: string[] | null;
  paymentMethodId?: string;
}) {
  text(value.customerAccount);
  text(value.stripeSubscriptionId);
  if (
    value.paymentMethodId !== undefined &&
    value.previousPaymentMethodId === value.paymentMethodId
  )
    throw new Error("Invalid restoration balance payment method.");
  if (value.previousPaymentMethodId !== null)
    text(value.previousPaymentMethodId);
  if (value.previousPaymentMethodTypes !== null) {
    if (value.previousPaymentMethodTypes.includes("stripe_balance"))
      throw new Error(
        "Invalid restoration from an already-enabled subscription.",
      );
    if (value.previousPaymentMethodTypes.length > 50)
      throw new Error("Invalid restoration payment method types.");
    value.previousPaymentMethodTypes.forEach(text);
  }
}
