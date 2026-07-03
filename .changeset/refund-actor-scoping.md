---
"@getdojo/better-stripe": minor
---

Add refund actor scoping — seller (own sales) vs platform admin (BTS-35, #56).

`createRefund` (BTS-34) previously had no notion of who may initiate a refund. It now takes an optional `actor` option (`{ type: "admin" }` or `{ type: "seller", accountId }`) and enforces the rule before any Stripe call is made — an unauthorized refund never moves money. A platform admin may refund any sale; a seller may refund only sales routed to their own connected account (destination charge, or one of the split legs in a separate-charges split), resolved from the payment's own component-ledger routing. Fails closed: a seller is denied when the payment's routing can't be resolved.

Additive and backwards compatible — omitting `actor` preserves the prior unrestricted behavior. The refund fee/transfer-reversal math from BTS-34 is unchanged.
