---
"@getdojo/better-stripe": minor
---

Add product-level `statement_descriptor` so it covers a subscription's first charge (BTS-67, #63).

The invoice-time descriptor path (BTS-32) sets the descriptor at `invoice.created`, which never reaches a subscription's first invoice — Stripe finalizes and (for `charge_automatically`/Checkout subscription-mode) pays invoice #1 synchronously at creation, before that handler runs. Per Stripe's descriptor precedence (Invoice → Product → charge-type default), a product-level `statement_descriptor` covers every cycle including the first.

`createProduct`/`updateProduct` now resolve the per-store descriptor (the store's stored suffix, else the platform default — mirroring the BTS-32 account-level resolution) and stamp it onto the Stripe Product's `statement_descriptor`, for products with an `accountId`. No public API change to existing call shapes.
