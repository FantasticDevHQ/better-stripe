---
"@getdojo/better-stripe": minor
---

Add headless `BuyerBillingView` component (BTS-39, #50).

The buyer's embedded-only, in-app billing surface: shows a buyer's subscriptions grouped by store (via the existing `groupSubscriptionsByStore` util, not recomputed), with per-store cancel/reactivate through the shared `SubscriptionCard`/`SubscriptionActions`, the one saved payment method reusable across every store, and an embedded (no-redirect) card-update slot.

React-surface only — no server/schema changes, no new dependencies. Full headless convention: `className`, per-label i18n overrides, `children` render-prop, loading/empty states. Purely additive.
