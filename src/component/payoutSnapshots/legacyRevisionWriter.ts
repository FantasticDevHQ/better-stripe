import type { MutationCtx } from "../_generated/server.js";
import { addSummaryAmounts as add } from "../earnings/arithmetic.js";

/** Preserve the legacy pair until this account explicitly activates its journal. */
export async function bumpLegacyRevision(
  ctx: MutationCtx,
  accountId: string,
  risk: boolean,
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
  return next.riskRevision;
}
