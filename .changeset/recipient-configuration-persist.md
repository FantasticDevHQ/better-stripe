---
"@getdojo/better-stripe": patch
---

Fix `addRecipientConfiguration` not persisting `appliedConfigurations` to the component DB (BTS-71).

`addRecipientConfiguration` applied the V2 recipient configuration on Stripe but never wrote the result back to the component `accounts` row, unlike `addCustomerConfiguration` which re-fetches and records `applied_configurations` after every update. Callers had to manually run `syncAllAccounts` afterward to reconcile the component DB, leaving it stale in between — anything reading `appliedConfigurations` off the component row (e.g. billing-view/UI gating) saw an out-of-date picture. `addRecipientConfiguration` now follows the same pattern: re-fetch the account after the Stripe update, read `applied_configurations`, recover the owning `userId` from the existing component record (failing closed with `ACCOUNT_NOT_FOUND` if the account isn't in the component DB yet), and `upsertAccount`. No public API change on the call side; the return shape now includes `appliedConfigurations` alongside `success`, matching `addCustomerConfiguration`.
