---
"@getdojo/better-stripe": minor
---

Smart-retry dunning: surface failed subscription cycles (BTS-33).

`invoice.payment_failed` previously upserted the invoice but fired **no** async hook, so apps couldn't react to a failed subscription cycle. It now schedules a new invoice-level hook:

- **`AsyncHooks.onInvoicePaymentFailed(ctx, invoice)`** — fires on `invoice.payment_failed` (mapped to the internal `afterInvoicePaymentFailed` hook). This is the invoice-level (subscription-cycle) failure, distinct from `onPaymentFailed`, which fires on a one-time **PaymentIntent** failure and receives a payment, not an invoice. The delinquency transition itself (`past_due` → `unpaid`) still arrives via `customer.subscription.updated` → `onSubscriptionUpdated`.

**Retry metadata on the invoice row** (two new optional fields, additive — no migration): `nextPaymentAttempt` (ISO time of Stripe's next Smart Retry) and `attemptCount`. The dunning hook receives these on the committed invoice so an email can tell the buyer when Stripe will retry.

**No custom retry loop.** Recovery timing is owned by Stripe Smart Retries — enable it in the Dashboard (Billing → Revenue recovery → Retries for subscriptions; Settings → Billing → Invoices for one-time invoices). See the README "Dunning & smart retries" section.

**Breaking (pre-1.0):** the internal `AsyncHookName` union grew by `afterInvoicePaymentFailed`. Apps using the recommended `webhookHandlers()` + `webhooks: internal.stripe` wiring need **no changes** — the pair is unchanged and the new hook field is optional.

Note: covered by unit tests (hook scheduling, invoice state transition + retry metadata, `past_due`/`unpaid` persistence). The live `invoice.payment_failed` path (real failed-card subscription cycle) should be exercised by the E2E webhook run before release.
