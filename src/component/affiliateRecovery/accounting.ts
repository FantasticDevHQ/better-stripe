import type { Doc } from "../_generated/dataModel.js";
import type { MutationCtx, QueryCtx } from "../_generated/server.js";
export type Obligation = Omit<
  Doc<"affiliateObligations">,
  "_id" | "_creationTime"
>;
export const target = (row: Obligation) =>
  row.finalizedAmount + row.provisionalAmount;
export const netRecovery = (row: Obligation) =>
  row.recoveredAmount + (row.offsetAmount ?? 0) - (row.restoredAmount ?? 0);
export const due = (row: Obligation) =>
  Math.max(0, target(row) - netRecovery(row));
export const credit = (row: Obligation) =>
  row.needsReconciliation ? 0 : Math.max(0, netRecovery(row) - target(row));
export async function balance(
  ctx: MutationCtx | QueryCtx,
  account: string,
  currency: string,
) {
  return ctx.db
    .query("affiliateRecoveryBalances")
    .withIndex("by_affiliate_currency", (q) =>
      q.eq("affiliateAccountId", account).eq("currency", currency),
    )
    .unique();
}
export async function changeBalance(
  ctx: MutationCtx,
  account: string,
  currency: string,
  changes: Partial<
    Record<
      | "originalCommission"
      | "recoveredAmount"
      | "offsetAmount"
      | "restoredAmount"
      | "outstandingDebt"
      | "reservedRecovery"
      | "reservedRestoration"
      | "restorationDue"
      | "withheldAmount"
      | "netPayable",
      number
    >
  >,
) {
  const existing = await balance(ctx, account, currency);
  const base = existing ?? {
    affiliateAccountId: account,
    currency,
    originalCommission: 0,
    recoveredAmount: 0,
    offsetAmount: 0,
    restoredAmount: 0,
    outstandingDebt: 0,
    reservedRecovery: 0,
    reservedRestoration: 0,
    restorationDue: 0,
    withheldAmount: 0,
    netPayable: 0,
  };
  const patch: Record<string, number> = {};
  for (const key of Object.keys(changes) as (keyof typeof changes)[]) {
    const next = base[key] + (changes[key] ?? 0);
    if (!Number.isSafeInteger(next) || next < 0)
      throw new Error(`Invalid affiliate balance ${key}.`);
    patch[key] = next;
  }
  if (existing)
    await ctx.db.patch("affiliateRecoveryBalances", existing._id, patch);
  else await ctx.db.insert("affiliateRecoveryBalances", { ...base, ...patch });
}
export async function updateObligation(
  ctx: MutationCtx,
  previous: Doc<"affiliateObligations">,
  patch: Partial<Obligation>,
) {
  if (!previous.accounted) {
    await changeBalance(ctx, previous.affiliateAccountId, previous.currency, {
      originalCommission: previous.originalCommission,
      recoveredAmount: previous.recoveredAmount,
      offsetAmount: previous.offsetAmount ?? 0,
      restoredAmount: previous.restoredAmount ?? 0,
      outstandingDebt: due(previous),
      restorationDue: credit(previous),
      reservedRecovery: previous.reservedRecovery ?? 0,
      reservedRestoration: previous.reservedRestoration ?? 0,
    });
  }
  const next = { ...previous, ...patch };
  const debtAmount = due(next),
    creditAmount = credit(next);
  await changeBalance(ctx, next.affiliateAccountId, next.currency, {
    outstandingDebt: debtAmount - (previous.debtAmount ?? due(previous)),
    restorationDue: creditAmount - (previous.creditAmount ?? credit(previous)),
    recoveredAmount: next.recoveredAmount - previous.recoveredAmount,
    offsetAmount: (next.offsetAmount ?? 0) - (previous.offsetAmount ?? 0),
    restoredAmount: (next.restoredAmount ?? 0) - (previous.restoredAmount ?? 0),
    reservedRecovery:
      (next.reservedRecovery ?? 0) - (previous.reservedRecovery ?? 0),
    reservedRestoration:
      (next.reservedRestoration ?? 0) - (previous.reservedRestoration ?? 0),
  });
  await ctx.db.patch("affiliateObligations", previous._id, {
    ...patch,
    accounted: true,
    debtAmount,
    creditAmount,
    debtStatus: debtAmount > 0 ? "open" : "settled",
  });
}
