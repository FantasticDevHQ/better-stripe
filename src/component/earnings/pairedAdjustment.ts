import type { MutationCtx } from "../_generated/server.js";
import { addSummaryAmounts } from "./arithmetic.js";

export type Contribution = {
  accountId: string;
  currency: string;
  gross: number;
  reversed: number;
  paidOut: number;
  count: number;
};
function apply(
  row: {
    gross: number;
    reversed: number;
    paidOut: number;
    count: number;
  } | null,
  contribution: Contribution,
  sign: 1 | -1,
) {
  const totals = {
    gross: addSummaryAmounts(row?.gross ?? 0, sign * contribution.gross),
    reversed: addSummaryAmounts(
      row?.reversed ?? 0,
      sign * contribution.reversed,
    ),
    paidOut: addSummaryAmounts(row?.paidOut ?? 0, sign * contribution.paidOut),
    count: addSummaryAmounts(row?.count ?? 0, sign * contribution.count),
  };
  addSummaryAmounts(totals.gross, -totals.reversed);
  return totals;
}
/** Same bucket only: preserve subtract/reset/reapply validation with one read. */
export async function replaceContribution(
  ctx: MutationCtx,
  previous: Contribution,
  next: Contribution,
) {
  if (
    previous.accountId !== next.accountId ||
    previous.currency !== next.currency
  )
    throw new Error("Paired contributions require the same currency bucket");
  const row = await ctx.db
    .query("currencyTotals")
    .withIndex("by_account_kind_currency", (q) =>
      q
        .eq("accountId", previous.accountId)
        .eq("kind", "earnings")
        .eq("currency", previous.currency),
    )
    .unique();
  const removed = apply(row, previous, -1);
  // The existing subtract path deletes a zero-count stored row before reapply.
  const hasIntermediateRow = !row || removed.count !== 0;
  const totals = apply(hasIntermediateRow ? removed : null, next, 1);
  if (hasIntermediateRow && totals.count === 0) {
    if (row) await ctx.db.delete("currencyTotals", row._id);
    return;
  }
  if (
    row &&
    (["gross", "reversed", "paidOut", "count"] as const).every((field) =>
      Object.is(row[field], totals[field]),
    )
  )
    return;
  if (row) await ctx.db.patch("currencyTotals", row._id, totals);
  else
    await ctx.db.insert("currencyTotals", {
      accountId: next.accountId,
      currency: next.currency,
      kind: "earnings",
      ...totals,
    });
}
