import { addSummaryAmounts as add } from "../../component/earnings/arithmetic.js";
type Source = {
  stripeTransferId: string;
  currency: string;
  transactions: { net: number; created: number }[];
};
/** FIFO ownership age after historical paid principal, source debt and verified payout fees. */
export function oldestUnpaidFunding(
  currency: string,
  sources: Source[],
  paid: { stripeTransferId: string; amount: number }[],
  fees: number,
  returned: {
    stripeTransferId: string;
    amount: number;
    created: number;
  }[] = [],
): number | undefined {
  if (!Number.isSafeInteger(fees) || fees < 0)
    throw new Error("Invalid payout fee amount.");
  const bySource = new Map<string, number>();
  for (const p of paid) {
    if (!Number.isSafeInteger(p.amount) || p.amount < 0)
      throw new Error("Invalid historical paid amount.");
    bySource.set(
      p.stripeTransferId,
      add(bySource.get(p.stripeTransferId) ?? 0, p.amount),
    );
  }
  sources = sources.map((s) => ({ ...s, transactions: [...s.transactions] }));
  const returnedTotals = new Map<string, number>();
  for (const r of returned) {
    const source = sources.find(
      (s) => s.stripeTransferId === r.stripeTransferId,
    );
    if (!source || !Number.isSafeInteger(r.amount) || r.amount <= 0)
      throw new Error("Invalid returned funding allocation.");
    const total = add(returnedTotals.get(r.stripeTransferId) ?? 0, r.amount);
    if (total > (bySource.get(r.stripeTransferId) ?? 0))
      throw new Error("Returned funding exceeds historical paid principal.");
    returnedTotals.set(r.stripeTransferId, total);
    source.transactions.push({ net: r.amount, created: r.created });
  }
  const chunks: { amount: number; created: number }[] = [];
  let debt = fees;
  for (const s of sources.filter((s) => s.currency === currency)) {
    let consumed = bySource.get(s.stripeTransferId) ?? 0;
    for (const t of s.transactions) {
      if (
        !Number.isSafeInteger(t.net) ||
        !Number.isSafeInteger(t.created) ||
        t.created < 0 ||
        !Number.isSafeInteger(t.created * 1000)
      )
        throw new Error("Invalid source funding age.");
      if (t.net < 0) consumed = add(consumed, -t.net);
    }
    for (const t of [...s.transactions]
      .filter((t) => t.net > 0)
      .sort((a, b) => a.created - b.created)) {
      const used = Math.min(consumed, t.net);
      consumed = add(consumed, -used);
      const amount = add(t.net, -used);
      if (amount) chunks.push({ amount, created: t.created });
    }
    debt = add(debt, consumed);
  }
  for (const c of chunks.sort((a, b) => a.created - b.created)) {
    const used = Math.min(debt, c.amount);
    debt = add(debt, -used);
    if (c.amount > used) return c.created * 1000;
  }
  return undefined;
}
