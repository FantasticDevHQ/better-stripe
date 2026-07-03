---
"@getdojo/better-stripe": minor
---

Add headless `PayoutSchedule` component for recipient balance + payout display (BTS-38, #46).

Pure, hook-free component showing a seller's available/pending balance (from a `RecipientBalance` snapshot prop) and next payout — the earliest `pending`/`in_transit` payout row with an arrival date, templated as "Next payout of $40.00 expected Jul 10, 2026", falling back to a rolling-schedule message when none is upcoming (payouts are automatic/rolling; the component deliberately offers no manual withdrawal). Optional `manageUrl` link out to the hosted Express dashboard.

Headless conventions: `className`, i18n label overrides, loading/empty states, and a `children` render-prop with all computed state. Data comes entirely via props (no data-fetching hook yet); purely additive.
