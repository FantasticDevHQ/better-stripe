---
"@getdojo/better-stripe": minor
---

Add `DisputeDetail` + `EvidenceForm` headless React components (BTS-54, #40).

- `DisputeDetail` — renders a dispute's amount, reason, status, evidence-due countdown message, and linked transfer ids. Loading/empty states, i18n label overrides.
- `EvidenceForm` — headless controlled form for the four Skool-style evidence fields (product description, access activity, additional info, customer communication); `stage()` saves a draft (no `submit` key), `submit()` finalizes with `submit: true`. Supports `stripeAccountId` scoping and `onStaged`/`onSubmitted`/`onError` callbacks.

Both are headless/themeable (`className` plus a `children` render-prop) and consume the existing BTS-31/BTS-53 core with no duplicated logic. Purely additive.
