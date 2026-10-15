import { addSummaryAmounts as add } from "../../component/earnings/arithmetic.js";
export type HistoricalFundingSource = {
  stripeTransferId: string;
  currency: string;
  transactions: {
    net: number;
    created: number;
    availableOn: number;
    status: string;
  }[];
};
export type HistoricalFundingPayout = {
  stripePayoutId: string;
  currency: string;
  amount: number;
  created: number;
  returnedAt?: number;
  allocations: { stripeTransferId: string; amount: number }[];
};
function integer(n: number) {
  if (!Number.isSafeInteger(n))
    throw new Error("Invalid historical funding arithmetic.");
  return n;
}
function timestamp(n: number) {
  if (integer(n) < 0) throw new Error("Invalid historical funding timestamp.");
}
/** Validate explicit historical cash provenance, not today's still-unpaid entitlement. */
export function validateHistoricalFunding(
  sources: HistoricalFundingSource[],
  payouts: HistoricalFundingPayout[],
): void {
  const byId = new Map<string, HistoricalFundingSource>();
  for (const s of sources) {
    if (byId.has(s.stripeTransferId))
      throw new Error("Duplicate historical funding source.");
    if (!/^tr_\w+$/.test(s.stripeTransferId) || !/^[a-z]{3}$/.test(s.currency))
      throw new Error("Invalid historical funding source.");
    for (const t of s.transactions) {
      integer(t.net);
      timestamp(t.created);
      timestamp(t.availableOn);
      if (!["available", "pending"].includes(t.status))
        throw new Error("Invalid historical funding status.");
    }
    byId.set(s.stripeTransferId, s);
  }
  const ids = new Set<string>();
  for (const p of payouts) {
    if (ids.has(p.stripePayoutId))
      throw new Error("Duplicate historical payout.");
    ids.add(p.stripePayoutId);
    if (
      !/^po_\w+$/.test(p.stripePayoutId) ||
      !/^[a-z]{3}$/.test(p.currency) ||
      integer(p.amount) <= 0
    )
      throw new Error("Invalid historical payout principal.");
    timestamp(p.created);
    if (p.returnedAt !== undefined) {
      timestamp(p.returnedAt);
      if (p.returnedAt < p.created)
        throw new Error("Historical payout return predates the payout.");
    }
  }
  const prior: HistoricalFundingPayout[] = [];
  for (const p of [...payouts].sort(
    (a, b) =>
      a.created - b.created || a.stripePayoutId.localeCompare(b.stripePayoutId),
  )) {
    const seen = new Set<string>();
    let principal = 0;
    for (const a of p.allocations) {
      if (seen.has(a.stripeTransferId))
        throw new Error("Duplicate historical source allocation.");
      seen.add(a.stripeTransferId);
      if (integer(a.amount) <= 0)
        throw new Error("Invalid historical principal allocation.");
      principal = add(principal, a.amount);
      const s = byId.get(a.stripeTransferId);
      if (!s)
        throw new Error("Historical payout funding source is unavailable.");
      if (s.currency !== p.currency)
        throw new Error("Historical payout currency allocation mismatch.");
      let capacity = 0;
      for (const t of s.transactions)
        if (
          t.status === "available" &&
          Math.max(t.created, t.availableOn) <= p.created
        )
          capacity = add(capacity, t.net);
      for (const old of prior)
        if (old.returnedAt === undefined || old.returnedAt > p.created)
          for (const allocation of old.allocations)
            if (allocation.stripeTransferId === s.stripeTransferId)
              capacity = add(capacity, -allocation.amount);
      if (a.amount > capacity)
        throw new Error(
          "Historical payout exceeds verified mature source funding.",
        );
    }
    if (principal !== p.amount)
      throw new Error("Historical allocations do not equal payout principal.");
    prior.push(p);
  }
}
