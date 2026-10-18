import { convexToJson } from "convex/values";
import type { Doc } from "../_generated/dataModel.js";
import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import { addSummaryAmounts as add } from "../earnings/arithmetic.js";

type Journal = Doc<"payoutRevisionJournal">;
function valid(row: Journal) {
  return (
    Number.isSafeInteger(row.revision) &&
    Number.isSafeInteger(row.riskRevision) &&
    Number.isSafeInteger(row.financialRiskRevision) &&
    (row.kind === "baseline"
      ? row.fenceStream &&
        (row.financialPresent
          ? !!row.legacyFinancialId &&
            row.financialRiskRevision === row.riskRevision
          : !row.legacyFinancialId &&
            row.revision === 0 &&
            row.financialRiskRevision === 0) &&
        (!!row.legacyFinancialId ||
          !!row.legacyRiskId ||
          row.riskRevision === 0)
      : row.financialPresent &&
        row.financialRiskRevision === row.riskRevision &&
        !row.legacyFinancialId &&
        !row.legacyRiskId)
  );
}

function validEdge(rows: Journal[], fenceOnly: boolean) {
  const [next, previous] = rows;
  if (!next) return true;
  if (!previous) return next.kind === "baseline";
  if (next.kind !== "bump" || next.revision <= previous.revision) return false;
  return (
    (fenceOnly || next.revision === add(previous.revision, 1)) &&
    next.riskRevision === add(previous.riskRevision, next.fenceStream ? 1 : 0)
  );
}

/** One indexed range. Immutable entries use the existing financial counter as order. */
export async function journalHead(
  ctx: QueryCtx | MutationCtx,
  accountId: string,
  fenceOnly = false,
) {
  const rows = fenceOnly
    ? await ctx.db
        .query("payoutRevisionJournal")
        .withIndex("by_account_fence_revision", (q) =>
          q.eq("accountId", accountId).eq("fenceStream", true),
        )
        .order("desc")
        .take(2)
    : await ctx.db
        .query("payoutRevisionJournal")
        .withIndex("by_account_revision", (q) => q.eq("accountId", accountId))
        .order("desc")
        .take(2);
  if (rows.some((row) => !valid(row)) || !validEdge(rows, fenceOnly))
    throw new Error(
      "Canonical payout revision journal is ambiguous or invalid.",
    );
  return rows[0] ?? null;
}

/** Activation never increments a financial counter or rewrites historical rows. */
export async function activateRevisionAccount(
  ctx: MutationCtx,
  accountId: string,
) {
  const held = (
    reason:
      | "legacy_ambiguous"
      | "legacy_invalid"
      | "legacy_disagreement"
      | "representation_unavailable",
  ) => ({ accountId, status: "held" as const, reason });
  if (new TextEncoder().encode(accountId).length > 900_000)
    return held("representation_unavailable");
  if (await journalHead(ctx, accountId))
    return { accountId, status: "unchanged" as const };
  const financial = await ctx.db
    .query("payoutFinancialRevisions")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .take(2);
  const risk = await ctx.db
    .query("payoutRiskRevisions")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .take(2);
  if (financial.length > 1 || risk.length > 1) return held("legacy_ambiguous");
  const row = financial[0];
  const fence = risk[0];
  const values = [
    row?.revision ?? 0,
    row?.riskRevision ?? 0,
    fence?.riskRevision ?? 0,
  ];
  if (values.some((value) => !Number.isSafeInteger(value)))
    return held("legacy_invalid");
  if (row && fence && row.riskRevision !== fence.riskRevision)
    return held("legacy_disagreement");
  const baseline = {
    accountId,
    revision: row?.revision ?? 0,
    riskRevision: fence?.riskRevision ?? row?.riskRevision ?? 0,
    financialRiskRevision: row?.riskRevision ?? 0,
    financialPresent: row !== undefined,
    fenceStream: true,
    kind: "baseline" as const,
    ...(row ? { legacyFinancialId: row._id } : {}),
    ...(fence ? { legacyRiskId: fence._id } : {}),
  };
  if (
    new TextEncoder().encode(JSON.stringify(convexToJson(baseline))).length >
    900_000
  )
    return held("representation_unavailable");
  await ctx.db.insert("payoutRevisionJournal", baseline);
  return { accountId, status: "activated" as const };
}

/** The unchanged centralized callbacks supply the same increment and risk decision. */
export async function appendRevision(
  ctx: MutationCtx,
  head: Journal,
  risk: boolean,
) {
  const revision = add(head.revision, 1);
  const riskRevision = add(head.riskRevision, risk ? 1 : 0);
  await ctx.db.insert("payoutRevisionJournal", {
    accountId: head.accountId,
    revision,
    riskRevision,
    financialRiskRevision: riskRevision,
    financialPresent: true,
    fenceStream: risk,
    kind: "bump",
  });
  return { revision, riskRevision };
}
