import type { Infer } from "convex/values";
import type { riskKind } from "./schema.js";
import type { Triggers } from "convex-helpers/server/triggers";
import type { DataModel, Doc } from "../_generated/dataModel.js";
import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import { addSummaryAmounts as add } from "../earnings/arithmetic.js";
import {
  transferFingerprint,
  payoutClaimFingerprint,
} from "../payoutRelease/helpers.js";
export async function financialRevision(
  ctx: QueryCtx | MutationCtx,
  accountId: string,
) {
  const row = await ctx.db
    .query("payoutFinancialRevisions")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .unique();
  return { revision: row?.revision ?? 0, riskRevision: row?.riskRevision ?? 0 };
}
/** Stable fence: ordinary positive funding never writes this row. */
export async function riskRevision(
  ctx: QueryCtx | MutationCtx,
  accountId: string,
) {
  const risk = await ctx.db
    .query("payoutRiskRevisions")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .unique();
  if (risk) return risk.riskRevision;
  return (await financialRevision(ctx, accountId)).riskRevision;
}
async function bump(
  ctx: MutationCtx,
  accountId: string,
  risk: boolean,
  kind: Infer<typeof riskKind>,
  key: string,
  removed = false,
) {
  const row = await ctx.db
    .query("payoutFinancialRevisions")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .unique();
  const fence = await ctx.db
    .query("payoutRiskRevisions")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .unique();
  if (row && fence && row.riskRevision !== fence.riskRevision)
    throw new Error("Financial risk revisions disagree.");
  const next = {
    revision: add(row?.revision ?? 0, 1),
    riskRevision: add(
      fence?.riskRevision ?? row?.riskRevision ?? 0,
      risk ? 1 : 0,
    ),
  };
  if (row) await ctx.db.patch("payoutFinancialRevisions", row._id, next);
  else await ctx.db.insert("payoutFinancialRevisions", { accountId, ...next });
  if (!fence)
    await ctx.db.insert("payoutRiskRevisions", {
      accountId,
      riskRevision: next.riskRevision,
    });
  else if (risk)
    await ctx.db.patch("payoutRiskRevisions", fence._id, {
      riskRevision: next.riskRevision,
    });
  if (risk)
    await ctx.db.insert("payoutRiskEvents", {
      accountId,
      riskRevision: next.riskRevision,
      kind,
      key,
      ...(removed ? { removed: true } : {}),
    });
}
function positiveOnly(
  old: Doc<"transfers"> | null,
  next: Doc<"transfers"> | null,
) {
  if (!next) return false;
  if (!old)
    return (
      next.amount >= 0 &&
      (next.reversedAmount ?? 0) === 0 &&
      (next.reversalClaimedAmount ?? 0) === 0 &&
      next.status !== "reversed"
    );
  const identity = (t: Doc<"transfers">) =>
    JSON.stringify([
      t.stripeTransferId,
      t.destinationAccountId,
      t.sourceChargeId,
      t.currency,
      t.role,
      t.reinstatement ?? false,
    ]);
  return (
    identity(old) === identity(next) &&
    next.amount >= old.amount &&
    (next.reversedAmount ?? 0) <= (old.reversedAmount ?? 0) &&
    (next.reversalClaimedAmount ?? 0) <= (old.reversalClaimedAmount ?? 0) &&
    next.status !== "reversed" &&
    !(old.status === "paid" && next.status !== "paid")
  );
}
function payoutFingerprint(p: Doc<"payouts">) {
  return JSON.stringify([
    p.stripePayoutId,
    p.accountId,
    p.amount,
    p.currency,
    p.status,
    p.arrivalDate,
    p.method,
    p.failureCode,
    p.failureMessage,
  ]);
}
/** Funding, payout claims and allocations commit with their revision counters. */
export function registerPayoutRevisions(triggers: Triggers<DataModel>) {
  triggers.register("recoveryBalances", async (ctx, change) => {
    const fingerprint = (row: Doc<"recoveryBalances"> | null) =>
      row
        ? JSON.stringify([
            row.accountId,
            row.scopeKey,
            row.currency,
            row.amountDue,
            row.collectedAmount,
          ])
        : null;
    if (fingerprint(change.oldDoc) === fingerprint(change.newDoc)) return;
    for (const account of new Set([
      change.oldDoc?.accountId,
      change.newDoc?.accountId,
    ]))
      if (account)
        await bump(
          ctx,
          account,
          true,
          "liability",
          (change.newDoc ?? change.oldDoc)!.scopeKey,
          change.newDoc === null,
        );
  });
  triggers.register("transfers", async (ctx, change) => {
    if (
      change.oldDoc &&
      change.newDoc &&
      transferFingerprint(change.oldDoc) === transferFingerprint(change.newDoc)
    )
      return;
    const accounts = new Set([
      change.oldDoc?.destinationAccountId,
      change.newDoc?.destinationAccountId,
    ]);
    for (const account of accounts)
      if (account)
        await bump(
          ctx,
          account,
          !positiveOnly(change.oldDoc, change.newDoc),
          "transfer",
          (change.newDoc ?? change.oldDoc)!.stripeTransferId,
          change.newDoc === null,
        );
  });
  triggers.register("payouts", async (ctx, change) => {
    if (
      change.oldDoc &&
      change.newDoc &&
      payoutFingerprint(change.oldDoc) === payoutFingerprint(change.newDoc)
    )
      return;
    for (const account of new Set([
      change.oldDoc?.accountId,
      change.newDoc?.accountId,
    ]))
      if (account)
        await bump(
          ctx,
          account,
          true,
          "provider_payout",
          (change.newDoc ?? change.oldDoc)!.stripePayoutId,
          change.newDoc === null,
        );
  });
  triggers.register("payoutSourceAllocations", async (ctx, change) => {
    const fp = (s: Doc<"payoutSourceAllocations">) =>
      JSON.stringify([
        s.accountId,
        s.ownerKey,
        s.stripeTransferId,
        s.currency,
        s.paidAmount,
        s.reservedAmount,
      ]);
    if (
      change.oldDoc &&
      change.newDoc &&
      fp(change.oldDoc) === fp(change.newDoc)
    )
      return;
    for (const account of new Set([
      change.oldDoc?.accountId,
      change.newDoc?.accountId,
    ]))
      if (account)
        await bump(
          ctx,
          account,
          true,
          "allocation",
          (change.newDoc ?? change.oldDoc)!.stripeTransferId,
          change.newDoc === null,
        );
  });
  triggers.register("payoutReleaseClaims", async (ctx, change) => {
    if (
      change.oldDoc &&
      change.newDoc &&
      payoutClaimFingerprint(change.oldDoc) ===
        payoutClaimFingerprint(change.newDoc)
    )
      return;
    for (const account of new Set([
      change.oldDoc?.accountId,
      change.newDoc?.accountId,
    ]))
      if (account)
        await bump(
          ctx,
          account,
          true,
          "claim",
          (change.newDoc ?? change.oldDoc)!.operationKey,
          change.newDoc === null,
        );
  });
  triggers.register("payoutFeeBalances", async (ctx, change) => {
    const fp = (s: Doc<"payoutFeeBalances">) =>
      JSON.stringify([
        s.accountId,
        s.ownerKey,
        s.currency,
        s.amount,
        s.revision,
      ]);
    if (
      change.oldDoc &&
      change.newDoc &&
      fp(change.oldDoc) === fp(change.newDoc)
    )
      return;
    for (const account of new Set([
      change.oldDoc?.accountId,
      change.newDoc?.accountId,
    ]))
      if (account)
        await bump(
          ctx,
          account,
          true,
          "fee",
          (change.newDoc ?? change.oldDoc)!.currency,
          change.newDoc === null,
        );
  });
}
