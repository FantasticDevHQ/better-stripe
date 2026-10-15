import type { QueryCtx } from "../_generated/server.js";
import { addSummaryAmounts } from "./arithmetic.js";
export function previewSize(value = 50) {
  if (!Number.isInteger(value) || value < 0 || value > 100)
    throw new Error("Preview size must be an integer from 0 to 100");
  return value;
}
export async function currencyTotals(
  ctx: QueryCtx,
  accountId: string,
  kind: "earnings" | "payouts",
) {
  const pending =
    kind === "earnings"
      ? await ctx.db
          .query("transfers")
          .withIndex("by_account_totals_recorded", (q) =>
            q
              .eq("destinationAccountId", accountId)
              .eq("totalsRecorded", undefined),
          )
          .first()
      : await ctx.db
          .query("payouts")
          .withIndex("by_account_totals_recorded", (q) =>
            q.eq("accountId", accountId).eq("totalsRecorded", undefined),
          )
          .first();
  if (pending)
    throw new Error(
      "Currency totals require backfillCurrencyTotals before reading this account",
    );
  const rows = await ctx.db
    .query("currencyTotals")
    .withIndex("by_account_kind_currency", (q) =>
      q.eq("accountId", accountId).eq("kind", kind),
    )
    .take(501);
  if (rows.length > 500)
    throw new Error("Account exceeds supported currency count");
  for (const row of rows) {
    for (const value of [row.gross, row.reversed, row.paidOut, row.count])
      addSummaryAmounts(value, 0);
    addSummaryAmounts(row.gross, -row.reversed);
  }
  return rows;
}
