import type { Doc } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";

export async function getAccountEarnings(
  ctx: QueryCtx,
  args: { destinationAccountId: string; previewLimit?: number },
) {
  const previewLimit = args.previewLimit ?? 50;
  let currency: string | undefined;
  let gross = 0;
  let reversed = 0;
  let transferCount = 0;
  const transfers: Doc<"transfers">[] = [];

  for await (const tr of ctx.db
    .query("transfers")
    .withIndex("by_destination_account_id", (q) =>
      q.eq("destinationAccountId", args.destinationAccountId),
    )
    .order("desc")) {
    if (currency !== undefined && currency !== tr.currency)
      throw new Error(
        "Mixed currency account: use getAccountEarningsByCurrency",
      );
    currency = tr.currency;
    gross += tr.amount;
    reversed += tr.reversedAmount ?? 0;
    transferCount += 1;
    if (transfers.length < previewLimit) transfers.push(tr);
  }

  return { gross, reversed, transferCount, transfers };
}

export async function getAccountPayouts(
  ctx: QueryCtx,
  args: { accountId: string; previewLimit?: number },
) {
  const previewLimit = args.previewLimit ?? 50;
  let currency: string | undefined;
  let paidOut = 0;
  let payoutCount = 0;
  const payouts: Doc<"payouts">[] = [];

  for await (const p of ctx.db
    .query("payouts")
    .withIndex("by_account_id", (q) => q.eq("accountId", args.accountId))) {
    if (currency !== undefined && currency !== p.currency)
      throw new Error(
        "Mixed currency account: use getAccountPayoutsByCurrency",
      );
    currency = p.currency;
    payoutCount += 1;
    if (p.status === "paid") paidOut += p.amount;
    if (payouts.length < previewLimit) payouts.push(p);
  }

  return { paidOut, payoutCount, payouts };
}
