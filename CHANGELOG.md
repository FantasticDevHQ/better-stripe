# Changelog

<!--
  This file is maintained by Changesets — do not hand-edit released sections.
  To record a change, run `pnpm changeset` and commit the generated file in
  `.changeset/`. New version sections are prepended above by `changeset version`
  (run automatically in the "Version Packages" PR). History below 0.3.0 was
  written by hand before Changesets was adopted.
-->

## 0.2.0 — 2026-06-11

### Breaking

- Trigger system is now wired into webhook processing. `triggersApi()` no longer returns `on*`/`after*` wrappers keyed by event; it returns 9 sync dispatchers (`accountUpserted`, `productUpserted`, `priceUpserted`, `subscriptionUpserted`, `subscriptionDeleted`, `checkoutSessionUpserted`, `invoiceUpserted`, `paymentUpserted`, `payoutUpserted`) plus 9 async hook wrappers (`afterAccountUpdated`, `afterCheckoutCompleted`, `afterSubscriptionUpdated`, `afterSubscriptionCanceled`, `afterTrialEnding`, `afterInvoicePaid`, `afterPaymentSucceeded`, `afterPaymentFailed`, `afterPayoutCompleted`). Each dispatcher performs the component upsert and the configured sync trigger in one transaction; `after*` hooks are scheduled via `ctx.scheduler` after the event is marked processed.
  - Migration: export all 18 names from a Convex module and pass it to `registerRoutes` via the new `triggers` config (`triggers: internal.stripe`, no cast needed). See the README Quick Start.
- `listPayouts` filter renamed `accountId` → `stripeAccountId`, with new optional `status` and `limit` filters.

### Added

- `getInvoice` / `getInvoiceByStripeId` client query methods, plus `getInvoiceByStripeId`, `getPaymentByStripeId`, and `getPayoutByStripeId` component queries.
- `createAccountSession` for Stripe Connect embedded account management (throws structured `ConvexError(BetterStripeError)` on failure).
- `customer.subscription.trial_will_end` webhook support (fires the `onTrialEnding` async hook); V1 event constant list grows to 20 events (32 total).
- Account-scoped listing: `listSubscriptions` now accepts `{ stripeAccountId?, status?, limit? }` and `listInvoices` accepts `stripeAccountId`; new `accountId` indexes on `checkoutSessions`, `invoices`, and `payments`.
- `TriggerApiRefs` type and `triggers` field on `RegisterRoutesConfig`.
- React: `countryPlaceholder` i18n prop on `AccountCreateCard`.
- Example app: trigger dispatchers wired into `registerRoutes`; billing portal session created via a component-backed action.
- Example app: automated E2E webhook test harness (`npm run e2e:webhooks`) — fires real Stripe-signed events via `stripe trigger`/`stripe listen` against the deployed endpoint and asserts the ledger plus a new `triggerLog` table that records every sync-trigger/async-hook invocation (sync triggers write in the same transaction as the dispatcher).

### Fixed

- V2 thin-event verification was broken under stripe-node v22: `webhooks.constructEventAsync` rejects thin payloads after verifying the signature, so every correctly signed `v2.core.*` event was returned a 400. `verifyV2Event` now uses `stripe.parseEventNotificationAsync`.
- Failed webhook ledger events are reprocessed on Stripe retry instead of deduplicating forever; sync-trigger failures roll back the component upsert and return 500 so Stripe retries.
- Async hooks now run after the upsert transaction commits, with the committed doc.
- React rules-of-hooks violations: `useQuery` is always called, using Convex's `"skip"` sentinel in 6 conditional read hooks.
- React: `AddCardForm` tracks real processing/error state; `BillingPortalLink` tracks async loading state.
- `clearAllTables` now also clears the `webhookEvents` ledger.
- `getTrialStatus` trial fields derived from shared subscription fields.

### Changed

- Component return validators fully typed — 30 `v.any()` return validators replaced across core, products, billing, connect, and webhooks; client status unions narrowed and `as any` casts dropped.
- Stripe API version pin upgraded to `2026-05-27.dahlia`; dependencies bumped (convex 1.41, stripe-js 9.8, react-router 7.17).

## 0.1.0

- Initial extraction from Dojo monorepo
- Stripe V2 Accounts API support
- Webhook handling (V1 snapshot + V2 thin events)
- Full CRUD for accounts, products, prices, subscriptions, checkout sessions, invoices, payments, payouts
