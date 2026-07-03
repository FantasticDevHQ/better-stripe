---
"@getdojo/better-stripe": minor
---

Add `getAccountBalance` for per-account balance retrieval (BTS-65, #62).

New `BetterStripe.getAccountBalance({ stripeAccountId })` reads a connected account's live Stripe balance, scoped via the `Stripe-Account` header (mirroring the other per-account calls like `createPayout`). Pairs Stripe's separate `available`/`pending` per-currency lists into one `AccountBalance` (`{ available, pending, currency }`, minor units) per currency — a currency present on only one side defaults to `0` on the other. `AccountBalance` is re-exported at the package root, and its shape matches the `PayoutSchedule` component's `balance` prop directly.

Purely additive.
