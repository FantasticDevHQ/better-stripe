---
"@getdojo/better-stripe": minor
---

Add headless `DisputesList` component with due-by countdown badges (BTS-40, #41).

Pure, hook-free presentational list of a seller's disputes, sorted by evidence deadline (soonest first, no-deadline rows last, overdue rows naturally at the top). Rows accept the exact shape `getDisputeWithCountdown`/`useDisputeWithCountdown` (BTS-53) produce, so the component never recomputes deadlines itself.

Headless overrides: `className`, i18n labels (`emptyLabel`, `loadingLabel`, `dueLabel`/`overdueLabel` with `{days}` templating), a per-row `renderRow` slot, and a whole-list `children` render prop. Default markup is semantic `ul[role=list] > li[data-dispute-id]` with a `span[role=status]` badge carrying `data-overdue`. Purely additive.
