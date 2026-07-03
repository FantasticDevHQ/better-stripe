---
"@getdojo/better-stripe": minor
---

Exact earnings totals — fix silently truncated financial figures past 50 rows (BTS-64).

`listTransfersByAccount` and `listPayouts` cap their results at 50 rows, and the `useEarnings` hook summed those rows client-side — so an account with more than 50 transfers or payouts reported **silently wrong** (understated) gross / reversed / net / paid-out totals, with no error.

**Fix:** two new server-side aggregate queries sum the account's whole ledger, paginated to completion, so totals are exact regardless of row count:

- **`connect/queries/getAccountEarnings({ destinationAccountId, previewLimit? })`** → `{ gross, reversed, transferCount, transfers }`. Exact `gross`/`reversed` over every transfer (incl. reinstatements — the earnings view); `transfers` is a bounded preview (`previewLimit ?? 50`) for drill-down.
- **`connect/queries/getAccountPayouts({ accountId, previewLimit? })`** → `{ paidOut, payoutCount, payouts }`. Exact `paidOut` over every `paid` payout; `payouts` is a bounded preview.

Exact up to Convex's per-query read limit; beyond that the query throws (loud) rather than silently truncating — strictly safer than a fixed cap for money figures.

**`createUseEarnings` now wires these aggregate queries** instead of the capped list queries. Its factory still takes `(useQuery, earningsQueryRef, payoutsQueryRef)` — point the refs at `getAccountEarnings` / `getAccountPayouts`. `UseEarningsResult` keeps `gross`/`reversed`/`net`/`paidOut`/`payouts`/`transfers` (now exact totals + a bounded preview) and adds `transferCount` / `payoutCount` for "showing N of M" UIs. `EarningsSummary` is unaffected (it reads the same figures).

**Behavior change:** if you wired `createUseEarnings` against `listTransfersByAccount` / `listPayouts`, repoint the refs at the new aggregate queries. The list queries and `BetterStripe.listPayouts()` are unchanged, now documented as capped drill-down views. `listTransfersByCharge` (per-sale split legs) is unchanged and safe in practice — a sale has few legs.
