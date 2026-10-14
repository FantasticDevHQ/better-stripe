import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import type { Doc } from "../_generated/dataModel.js";
export type Scope = { accountId: string; scopeKey: string; currency: string };
export function integer(value: number) {
  if (!Number.isSafeInteger(value))
    throw new Error("Recovery amounts must be safe integers.");
  return value;
}
export function validateScope(scope: Scope) {
  if (!scope.accountId || !scope.scopeKey || !/^[a-z]{3}$/.test(scope.currency))
    throw new Error("Recovery account, scope and currency are required.");
}
export const sign = (value: number) =>
  value > 0
    ? ("positive" as const)
    : value < 0
      ? ("negative" as const)
      : ("zero" as const);
export const scopeOnly = (scope: Scope): Scope => ({
  accountId: scope.accountId,
  scopeKey: scope.scopeKey,
  currency: scope.currency,
});
export const zeroTotals = {
  amountDue: 0,
  collectedAmount: 0,
  reservedAmount: 0,
  outstanding: 0,
};
export function readBalance(ctx: QueryCtx | MutationCtx, scope: Scope) {
  return ctx.db
    .query("recoveryBalances")
    .withIndex("by_scope", (q) =>
      q
        .eq("accountId", scope.accountId)
        .eq("scopeKey", scope.scopeKey)
        .eq("currency", scope.currency),
    )
    .unique();
}
export async function balance(ctx: MutationCtx, scope: Scope) {
  const found = await readBalance(ctx, scope);
  if (found) return found;
  const id = await ctx.db.insert("recoveryBalances", {
    ...scopeOnly(scope),
    ...zeroTotals,
  });
  return (await ctx.db.get("recoveryBalances", id))!;
}
export async function adjustTotals(
  ctx: MutationCtx,
  scope: Scope,
  delta: Partial<typeof zeroTotals>,
) {
  const stored = await balance(ctx, scope);
  const next = { ...zeroTotals };
  for (const key of Object.keys(zeroTotals) as (keyof typeof zeroTotals)[])
    next[key] = integer(stored[key] + (delta[key] ?? 0));
  if (
    next.outstanding !==
    integer(next.amountDue - next.collectedAmount - next.reservedAmount)
  )
    throw new Error("Recovery totals do not reconcile.");
  await ctx.db.patch("recoveryBalances", stored._id, next);
}
export function groupTarget(group: Doc<"recoveryGroups">, outstanding: number) {
  return Math.max(
    -group.maxCredit,
    Math.min(group.maxDebit, integer(outstanding + group.amount)),
  );
}
export async function getGroup(ctx: MutationCtx, key: string) {
  const group = await ctx.db
    .query("recoveryGroups")
    .withIndex("by_key", (q) => q.eq("groupKey", key))
    .unique();
  if (!group) throw new Error("Recovery group is missing.");
  return group;
}
export function batchLimit(limit: number, max = 100) {
  if (!Number.isInteger(limit) || limit < 1 || limit > max)
    throw new Error(`Recovery batch limit must be between 1 and ${max}.`);
}
