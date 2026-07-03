---
"@getdojo/better-stripe": patch
---

Regenerate the component's `_generated` API so transfer/dispute queries are typed for consumers (BTS-70, #71).

`src/component/_generated/component.ts` was stale — it predated `listTransfersByCharge`/`listTransfersByAccount` (BTS-50) and `getDisputeByStripeId`/`listDisputes` (BTS-31), so `components.betterStripe.connect.queries.*` for those methods was untyped for any consumer reaching into the raw component API. Regenerated via `npx convex codegen`; no source logic changed, generated bindings only.
