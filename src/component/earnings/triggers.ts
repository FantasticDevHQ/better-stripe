import { Triggers } from "convex-helpers/server/triggers";
import {
  customCtx,
  customMutation,
} from "convex-helpers/server/customFunctions";
import type { DataModel } from "../_generated/dataModel.js";
import {
  mutation as rawMutation,
  type MutationCtx,
} from "../_generated/server.js";

type Contribution = {
  accountId: string;
  currency: string;
  gross: number;
  reversed: number;
  paidOut: number;
  count: number;
};
async function adjust(
  ctx: MutationCtx,
  kind: "earnings" | "payouts",
  value: Contribution,
  sign: number,
) {
  const row = await ctx.db
    .query("currencyTotals")
    .withIndex("by_account_kind_currency", (q) =>
      q
        .eq("accountId", value.accountId)
        .eq("kind", kind)
        .eq("currency", value.currency),
    )
    .unique();
  const totals = {
    gross: (row?.gross ?? 0) + sign * value.gross,
    reversed: (row?.reversed ?? 0) + sign * value.reversed,
    paidOut: (row?.paidOut ?? 0) + sign * value.paidOut,
    count: (row?.count ?? 0) + sign * value.count,
  };
  if (row) {
    if (totals.count === 0) await ctx.db.delete("currencyTotals", row._id);
    else await ctx.db.patch("currencyTotals", row._id, totals);
  } else
    await ctx.db.insert("currencyTotals", {
      accountId: value.accountId,
      currency: value.currency,
      kind,
      ...totals,
    });
}
const triggers = new Triggers<DataModel>();
triggers.register("transfers", async (ctx, change) => {
  const contribution = (
    row: NonNullable<typeof change.newDoc>,
  ): Contribution => ({
    accountId: row.destinationAccountId,
    currency: row.currency,
    gross: row.amount,
    reversed: row.reversedAmount ?? 0,
    paidOut: 0,
    count: 1,
  });
  if (change.oldDoc?.totalsRecorded)
    await adjust(ctx, "earnings", contribution(change.oldDoc), -1);
  if (change.newDoc) {
    await adjust(ctx, "earnings", contribution(change.newDoc), 1);
    if (!change.newDoc.totalsRecorded)
      await ctx.innerDb.patch("transfers", change.id, { totalsRecorded: true });
  }
});
triggers.register("payouts", async (ctx, change) => {
  const contribution = (
    row: NonNullable<typeof change.newDoc>,
  ): Contribution => ({
    accountId: row.accountId,
    currency: row.currency,
    gross: 0,
    reversed: 0,
    paidOut: row.status === "paid" ? row.amount : 0,
    count: 1,
  });
  if (change.oldDoc?.totalsRecorded)
    await adjust(ctx, "payouts", contribution(change.oldDoc), -1);
  if (change.newDoc) {
    await adjust(ctx, "payouts", contribution(change.newDoc), 1);
    if (!change.newDoc.totalsRecorded)
      await ctx.innerDb.patch("payouts", change.id, { totalsRecorded: true });
  }
});
export const mutation = customMutation(rawMutation, customCtx(triggers.wrapDB));
