---
"@getdojo/better-stripe": patch
---

Fix: collect deferred `per_charge` platform fees via transfer reversal (BTS-60, #38).

`bsFeeMode="per_charge"` (used when a one-time destination charge's final amount isn't known up front — discounts, `custom_unit_amount` prices, or a `sessionOverrides`-replaced `line_items`) had no webhook consumer, so the fixed/tiered platform fee was silently never collected on those charges.

Fixed with a new `applyPerChargeFee` processor at `payment_intent.succeeded`: it collects the fee the same way Stripe itself settles application fees on destination charges — a partial reversal of the automatic destination transfer, sized by `computeFee` from the amount actually charged (`amount_received`). No public API change; charges that already pass `amount` up front (computing `application_fee_amount` at session creation) are unaffected.
