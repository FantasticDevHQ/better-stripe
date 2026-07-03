---
"@getdojo/better-stripe": patch
---

Fix a first-invoice fee double-reversal crack (BTS-69).

`applyFirstInvoiceFee` recomputed the platform fee from **live** subscription metadata (`bsFeeConfig`) on every webhook retry. If the transfer reversal succeeded but the `bsFeeCollected` invoice-marker write then failed (event marked `failed`), and the platform edited `bsFeeConfig` before Stripe redelivered, a retry landing **after** Stripe's ≤24h idempotency-key window would recompute a *different* fee and create a **second** reversal — double-collecting the fee.

**Fix:** before reversing, `applyFirstInvoiceFee` now lists the destination transfer's existing reversals and adopts one tagged `metadata.bsFeeFor:<invoiceId>` as the idempotency source of truth. That tag survives both the marker-write failure and the idempotency-key TTL, so a retry re-records the marker with the already-reversed amount instead of reversing again — mirroring BTS-60's frozen-config guarantee. No API surface change.
