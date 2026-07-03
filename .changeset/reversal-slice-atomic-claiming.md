---
"@getdojo/better-stripe": patch
---

Fix three transfer-reversal money races via atomic reversal-slice claiming (BTS-63, #61).

- Dispute clawback (amount mode): a retry after partial success recomputed per-leg amounts from mutable ledger state — a same-params replay could double-record the ledger, or a shifted remainder could resend different params under an already-used Stripe idempotency key, causing a permanent event-retry loop.
- Refund clawback (delta-to-target, BTS-34): two distinct refunds racing between the ledger read and the Stripe call could both compute the same reversal target from stale state, over-reversing a leg and under-recording the ledger.
- `payment_intent.succeeded` redelivery could have `upsertPayment`'s blanket patch rewrite `feeCollectedAmount` back to the gross fee, bypassing the monotonic fee-refund guard.

Fixed by claiming the exact reversal slice atomically, in a new component mutation, before any money moves — so a retry re-adopts the already-claimed slice instead of recomputing and re-reversing it. No public API change.
