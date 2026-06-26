---
"@getdojo/better-stripe": patch
---

Fix `createPrice` orphaning a Stripe price when the product is missing from the component DB (BTS-2).

`createPrice` previously called `stripe.prices.create(...)` **before** verifying the product existed in the component DB, then threw `PRODUCT_NOT_FOUND` afterward — leaving an orphaned price in Stripe with no corresponding component record. The product lookup now runs **first**, so a missing/unsynced product throws before any Stripe write happens. No API change; behavior only differs on the error path.
