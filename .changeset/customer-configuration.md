---
"@getdojo/better-stripe": minor
---

Add support for the V2 **customer configuration** — the billable entity in the V2 Accounts API, where a single Account with a customer configuration replaces the legacy V1 Customer object.

- `BetterStripe.addCustomerConfiguration(ctx, { stripeAccountId })` — applies the customer configuration to an existing account (making it usable in customer-facing payment/billing flows: subscriptions, invoices, and the billing portal via `customer_account: acct_…`), re-reads the configurations Stripe actually applied, and records them on the component account. Throws `ACCOUNT_NOT_FOUND` (without touching Stripe) if the account isn't in the component DB. Returns `{ success: true, appliedConfigurations }`.
- `BetterStripe.DEFAULT_CUSTOMER_CONFIGURATION` — the documented `{ customer: {} }` preset. Request `customer.capabilities.automatic_indirect_tax` separately if you need automatic tax on this account's invoices/subscriptions.

Previously `DEFAULT_ACCOUNT_CONFIGURATION` only requested the merchant configuration, so there was no first-class path to create a customer-billable account.
