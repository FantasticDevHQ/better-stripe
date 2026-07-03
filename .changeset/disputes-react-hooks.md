---
"@getdojo/better-stripe": minor
---

Add dispute React hooks: `createUseDisputes` + `createUseDisputeWithCountdown` (BTS-53, #36).

Two new factory hooks following the existing `createUse*` convention:

- `createUseDisputes` — wraps `listDisputes` with `account`/`status` filters (list-style, mirrors `createUseInvoices`); returns `{ disputes, isLoading }`.
- `createUseDisputeWithCountdown` — wraps `getDisputeWithCountdown` for a single dispute id (mirrors `createUseSubscription`); returns `{ dispute, countdown, isLoading }`, using Convex's `"skip"` sentinel when no id is provided.

Both wired into the `@getdojo/better-stripe/react` entry export; `StripeComponentDispute` re-exported for consumers. Purely additive.
