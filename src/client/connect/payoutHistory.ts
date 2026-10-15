import type Stripe from "stripe";
import type { TransferReceiptTransaction } from "./transferReceipt.js";
import { addSummaryAmounts as add } from "../../component/earnings/arithmetic.js";
export type PayoutHistoryVerification =
  | { status: "verified"; providerAvailable: number; observedAt: number }
  | {
      status: "held";
      reason:
        | "unallocated_history"
        | "history_changed"
        | "history_incomplete"
        | "balance_changed";
    };
function fingerprint(t: TransferReceiptTransaction) {
  return JSON.stringify([
    t.id,
    t.sourceId,
    t.amount,
    t.fee,
    t.net,
    t.currency,
    t.created,
    t.availableOn,
    t.status,
    t.type,
  ]);
}
function normalize(t: Stripe.BalanceTransaction): TransferReceiptTransaction {
  if (t.status !== "available" && t.status !== "pending")
    throw new Error("Invalid provider receipt status.");
  return {
    id: t.id,
    sourceId: typeof t.source === "string" ? t.source : (t.source?.id ?? ""),
    amount: t.amount,
    fee: t.fee,
    net: t.net,
    currency: t.currency,
    created: t.created,
    availableOn: t.available_on,
    status: t.status,
    type: t.type,
  };
}
/**
 * Verify a complete currency history against independently verified transfer and
 * payout receipts. Unknown debits AND credits require explicit allocation. A
 * current balance alone never establishes still-unpaid source ownership.
 */
export async function verifyPayoutHistory(
  stripe: Stripe,
  opts: {
    accountId: string;
    currency: string;
    transactions: TransferReceiptTransaction[];
    maxPages?: number;
  },
): Promise<PayoutHistoryVerification> {
  const maxPages = opts.maxPages ?? 10;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100)
    throw new Error("History page budget must be between 1 and 100.");
  if (!/^acct_\w+$/.test(opts.accountId) || !/^[a-z]{3}$/.test(opts.currency))
    throw new Error("Invalid payout history scope.");
  const expected = new Map<string, string>();
  for (const t of opts.transactions) {
    if (expected.has(t.id))
      throw new Error("Duplicate payout history receipt.");
    if (
      t.currency !== opts.currency ||
      !/^txn_\w+$/.test(t.id) ||
      !t.sourceId ||
      [t.amount, t.fee, t.net, t.created, t.availableOn].some(
        (n) => !Number.isSafeInteger(n),
      ) ||
      t.net !== add(t.amount, -t.fee)
    )
      throw new Error("Invalid payout history receipt.");
    expected.set(t.id, fingerprint(t));
  }
  const scope = { stripeAccount: opts.accountId };
  const seen = new Set<string>();
  let cursor: string | undefined, head: string | undefined;
  let available = 0,
    pending = 0,
    complete = false;
  const held = (
    reason: Extract<PayoutHistoryVerification, { status: "held" }>["reason"],
  ): PayoutHistoryVerification => ({ status: "held", reason });
  for (let page = 0; page < maxPages; page++) {
    const batch = await stripe.balanceTransactions.list(
      {
        currency: opts.currency,
        limit: 100,
        ...(cursor ? { starting_after: cursor } : {}),
      },
      scope,
    );
    if (page === 0 && batch.data[0])
      head = fingerprint(normalize(batch.data[0]));
    for (const raw of batch.data) {
      const t = normalize(raw);
      if (seen.has(t.id)) return held("history_incomplete");
      seen.add(t.id);
      if (!expected.has(t.id)) return held("unallocated_history");
      if (fingerprint(t) !== expected.get(t.id)) return held("history_changed");
      if (t.status === "available") available = add(available, t.net);
      else if (t.status === "pending") pending = add(pending, t.net);
      else return held("history_changed");
    }
    if (!batch.has_more) {
      complete = true;
      break;
    }
    const next = batch.data[batch.data.length - 1]?.id;
    if (!next || next === cursor) return held("history_incomplete");
    cursor = next;
  }
  if (!complete) return held("history_incomplete");
  if (seen.size !== expected.size) return held("history_changed");
  const balance = await stripe.balance.retrieve(undefined, scope);
  const latest = await stripe.balanceTransactions.list(
    { currency: opts.currency, limit: 1 },
    scope,
  );
  const latestHead = latest.data[0]
    ? fingerprint(normalize(latest.data[0]))
    : undefined;
  if (latestHead !== head) return held("history_changed");
  const entries = (rows: Stripe.Balance.Available[]) =>
    rows.filter((t) => t.currency === opts.currency);
  const a = entries(balance.available),
    p = entries(balance.pending);
  if (
    a.length > 1 ||
    p.length > 1 ||
    (a[0]?.amount ?? 0) !== available ||
    (p[0]?.amount ?? 0) !== pending
  )
    return held("balance_changed");
  // The durable payout request explicitly draws from card balance. Other rails
  // cannot increase this cap even if they contribute to aggregate availability.
  const card = a[0]?.source_types?.card ?? 0;
  if (!Number.isSafeInteger(card))
    throw new Error("Invalid provider card balance.");
  return {
    status: "verified",
    providerAvailable: Math.min(available, card),
    observedAt: Date.now(),
  };
}
