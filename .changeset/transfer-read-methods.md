---
"@getdojo/better-stripe": minor
---

Add `BetterStripe.listTransfersByCharge` and `BetterStripe.listTransfersByAccount` — client read wrappers over the component's transfer-ledger queries.

- `listTransfersByCharge(ctx, { sourceChargeId, limit? })` — a sale's original split legs (reinstatement rows excluded), the read behind the `useSplitBreakdown` hook / per-sale breakdown UIs.
- `listTransfersByAccount(ctx, { destinationAccountId, limit? })` — a recipient's transfer ledger (the earnings view, includes reinstatements), the read behind the `useEarnings` hook.

The underlying component queries already existed, but there was no client-side method to reach them, so an app couldn't wire the `useSplitBreakdown` / `useEarnings` hook factories to real data. These thin read wrappers close that gap (surfaced while building the affiliate-split demo, BTS-43).
