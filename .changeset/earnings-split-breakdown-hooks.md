---
"@getdojo/better-stripe": minor
---

Add `createUseEarnings` + `createUseSplitBreakdown` React hook factories (BTS-36, #44).

- `createUseEarnings(useQuery, transfersRef, payoutsRef)` → `useEarnings(accountId)` reads a recipient's transfer ledger and payouts, deriving `gross` (total transferred in), `reversed` (pulled back via fee collection + refund/dispute clawbacks — deliberately not labeled "fees", since a true platform-fees figure lives on the payments rows' `feeCollectedAmount`), `net`, `payouts`/`paidOut`, and the raw `transfers` for drill-down.
- `createUseSplitBreakdown(useQuery, transfersByChargeRef)` → `useSplitBreakdown({ sourceChargeId, saleAmount? })` sums a sale's split legs by role (`store`/`affiliate`/`other`), each net of reversals, with the `platform` share derived when the caller supplies the sale amount.

Both follow the `createUse*` factory convention from BTS-53. Purely additive.
