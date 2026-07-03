---
"@getdojo/better-stripe": minor
---

Add `SplitBreakdown` + `EarningsSummary` headless components (BTS-37, #49).

- `SplitBreakdown` renders a sale's store + affiliate + platform lines (the `other` bucket only when it carries money) from `useSplitBreakdown`'s totals. When the platform share is underivable (no sale amount given to the hook) it renders an explicit "Unknown without the sale amount" state — never a silent zero.
- `EarningsSummary` renders gross / reversals / net / paid-out plus the latest payout status line. Its props are a subset of `useEarnings`'s result shape, so `<EarningsSummary {...useEarnings(accountId)} />` works directly.

Consumes the BTS-36 hooks (#44). Both headless/themeable (`className` + `children` render-prop). Purely additive.
