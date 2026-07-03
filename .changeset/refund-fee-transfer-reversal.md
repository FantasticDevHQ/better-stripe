---
"@getdojo/better-stripe": minor
---

Refunds now return the platform fee pro-rata and reverse recipient transfers (BTS-34, #45).

**Destination charges:** `createRefund` gains `refundApplicationFee` and `reverseTransfer` options, both defaulting `true`, sent only when the charge actually carries an application fee / destination transfer (sending either on an incapable charge is a hard Stripe error). Stripe pro-rates both natively for partial refunds; an explicit `false` always wins.

**Split sales (transfer math):** a new `reverseTransfersForRefund` (driven from `refund.created`/`refund.updated`, so pending→succeeded ACH refunds and Dashboard-issued refunds both claw back) converges each ledger leg on a cumulative reversal target — `round(leg × amount_refunded / amount)` — and reverses only the delta above the already-recorded amount, so at-least-once webhook delivery can't double-record the ledger or trip Stripe idempotency-key conflicts.

Additive; no breaking changes to `createRefund`'s existing call shape.
