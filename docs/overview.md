# Package overview

## Features

- **V2 Accounts API** -- Account creation, onboarding, Connect/marketplace, merchant and recipient configurations
- **Products and Prices** -- Full CRUD with trial day management as a first-class feature
- **Checkout** -- Both embedded (custom UI mode) and redirect checkout session creation
- **Subscriptions** -- Lifecycle management including cancel, reactivate, quantity updates, and trial tracking
- **Marketplace fees** -- Platform fee config (percent, fixed, tiered), resolved per-call or as a global default, applied via `application_fee_percent`/`application_fee_amount` or computed per invoice/charge
- **Split engine** -- Single-recipient destination charges or multi-recipient separate-charges-and-transfers (store + affiliate(s)), computed and executed by the webhook engine
- **Invoices** -- Invoice syncing and querying with metadata propagation from subscriptions
- **Payments** -- Payment intent tracking and status management
- **Payouts** -- Automatic rolling payouts for Connect/marketplace flows, with a recipient balance + cadence React surface
- **Refunds** -- Refund tracking with refunded-amount/status denormalized onto the linked payment, plus proportional platform-fee return and transfer reversal (destination charges via Stripe flags, split sales via webhook-driven ledger math)
- **Disputes** -- Chargeback/dispute tracking with evidence submission and close helpers, plus automatic transfer clawback on open, reinstatement on a won dispute, and auto-cancel of the disputed subscription
- **Per-store statement descriptors** -- Buyer-recognizable charge descriptors resolved per seller with a configurable platform fallback
- **Webhook handling** -- Single-endpoint processing with ledger-based deduplication and replay protection
- **Trigger system** -- BetterAuth-style sync triggers (same transaction) and async hooks (scheduled action) for app-layer extensibility
- **React hooks** -- Read hooks and flow hooks for all billing and marketplace-economics domains (fees, splits, earnings, payouts, disputes)
- **Headless UI components** -- Checkout, subscription, payment method, Connect, payout, split, and dispute components with render-prop customization
- **Test utilities** -- Typed fixture factories, mock webhook events, and `assertTestEnvironment` guard

See [Roadmap / Known Gaps](#roadmap--known-gaps) for what's still in flight.

## Roadmap / Known Gaps

The marketplace economics layer includes platform fees, split transfers, rolling payouts, dispute recovery, refund reversals, and per-store statement descriptors. The former roadmap gaps are covered as follows:

- **First subscription charge descriptor** — `createProduct` and `updateProduct` stamp the store's descriptor (or platform fallback) onto store-owned Stripe products. The product descriptor covers the first invoice for direct subscriptions and Checkout subscription mode; the invoice-time descriptor still takes precedence on later invoices. Existing products need `updateProduct` to receive the descriptor, and a later store descriptor change requires refreshing its products. Shared products have one descriptor and should not be reused across stores that need different descriptors.
- **First-invoice fees** — finalized first invoices bypass the draft update window. At `invoice.paid`, the processor collects the fixed/tiered fee through a partial reversal of the destination transfer. Invoice markers and invoice-tagged reversals prevent duplicate collection, including recovery after a failed marker write. Renewals whose fees were set on the draft invoice are skipped.
- **Dispute reversal retries** — reversal slices are claimed atomically before any Stripe call. Partial-success retries reuse the recorded amounts and idempotency keys, skip confirmed legs, and reconcile money already moved before a ledger-write failure.
- **Affiliate commission recovery** — original commission snapshots, shared refund/dispute exposure, reversal receipts, and a resumable backfill are available. Currency-scoped future-commission offsets, receipt-backed dispute restoration, payout reservations, and reusable recovery views are included. See [affiliate commission clawbacks](affiliate-clawbacks.md).
- **Earnings and split totals** — `useEarnings` reads exact server-side aggregates with bounded drill-down previews. `listTransfersByAccount` remains a preview API; do not sum it for financial totals. `listTransfersByCharge` now returns every original split leg by default, and reversal claims cover up to 1,000 charge-linked transfer rows, failing explicitly above that bound. An explicit list limit requests a preview. Convex read/write/response limits fail loudly rather than silently truncate financial data.

### Relation to `@convex-dev/stripe`

This component targets the Stripe **V2 Accounts API** (Connect/marketplace-first) with a transactional trigger system. [`@convex-dev/stripe`](https://github.com/get-convex/stripe) targets the classic Customers/V1 API. They are different data models — there is no automated migration. Choose by which Stripe API generation your app uses.

## Accounts v2 customer preview

Choose the setup that matches your Stripe account:

| Integration                                                                           | Enable “Reusable payment methods for Global Payouts” for Accounts v2 access? | BetterStripe API version                                     |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Connect platform, including ordinary connected-account payouts and marketplace splits | No. Accounts v2 is GA for Connect.                                           | Omit `stripeApiVersion` to keep the GA default.              |
| Non-Connect merchant using customer-only Accounts v2 for checkout and billing         | Yes, in each intended sandbox/account.                                       | Set `stripeApiVersion: STRIPE_CUSTOMER_PREVIEW_API_VERSION`. |

For the non-Connect setup, the account owner enables that exact toggle under
[Account previews and features](https://dashboard.stripe.com/settings/previews)
→ **Product previews**. If it is missing or disabled, check with the account
owner and request access through [Stripe's customer-account guide](https://docs.stripe.com/accounts-v2/use-accounts-as-customers).
The Dashboard does not always explain why a toggle is disabled. Do not enable
Connect just to bypass the customer-preview requirement.

The exported preview constant currently selects `2026-09-30.preview`, which
passed our live non-Connect checkout and billing tests. A newer version selected
in Stripe's API documentation does not enable account features or change this
package's supported-version list. Both account enablement and a supported
preview request version are necessary. Use `stripe.registerRoutes` to inherit
the client's version for webhook processing, and pin snapshot destinations to
the same version.

The table covers **Accounts v2 access**. Actually reusing saved payment methods
for **Global Payouts** is a separate preview feature with its own eligibility,
even for Connect users. See [Stripe's credential-reuse guide](https://docs.stripe.com/global-payouts/credential-reuse).
Enabling this toggle also synchronizes existing Customers into customer-configured
Accounts and changes customer creation in Stripe-hosted integrations. Review
those migration effects before enabling it on an existing account.
See the [customer preview setup and webhook migration guide](accounts-v2-preview.md).

Recipient-held custom payout policies now have versioned preparation, verified
manual schedule changes, live drift checks, opt-out restoration, and a bounded
deadline-expiry API. See [policy setup and limits](settlement.md#recipient-held-payout-policy-controls).
A [recipient funding reader](settlement.md#verified-recipient-funding-receipts)
verifies original and reversal receipts, maturity, and exact settlement amounts;
received credit is kept distinct from still-unpaid entitlement.
A [payout receipt and reconciliation API](settlement.md#verified-payout-receipts-and-reconciliation)
verifies actual bank-payout debits and returns, adopts an attempted claim's
provider outcome, and books its net payout fees once.
The [combined release API](settlement.md#combined-recipient-release) verifies
complete source and payout history, reserves mature unpaid funds, and creates an
idempotent bank payout. Install a host job to invoke it and expire due policies.
The [automatic worker](settlement.md#automatic-recipient-worker) provides
durable attempt IDs, retry leases, recovery discovery and the next attempt time.
The example installs its five-minute cron in `example/convex/crons.ts`.
A [payout eligibility preview](settlement.md#payout-eligibility-preview)
uses the release qualification checks to report combined mature funds, pending
credits, shared deductions and source categories without creating a bank payout.
The unstyled React [`PayoutProgress`](react-workflows.md#combined-automatic-payout-progress)
displays that assessment with one combined minimum and supports custom cards
and translated copy through render props.
[`PayoutSettings`](react-workflows.md#payout-settings)
adds consent, exact minimum entry, pending-state recovery and account-wide opt-out
through authorized host callbacks. Seller and affiliate payout pages use both.
[Historical imports and explicit funded activation](settlement.md#historical-import-and-funded-activation)
verify old payouts, source ownership and holding age before enabling a custom
schedule. Larger histories and unallocated money still require reconciliation;
schedule controls alone do not enforce a minimum.
[Resumable local collections and reset safeguards](settlement.md#resumable-local-collections)
provide bounded ledger inspection while provider-history continuation and scalable
claim execution are completed.

## Component history and currency summaries

See the [read contract guide](read-contracts.md) for reactive product, price and payout
cursors, exact currency summaries, legacy backfill, payout failure details, and
published-version adoption requirements.

For buyer purchase-history discovery, use the public invoice and
[Checkout-session page readers](checkout-session-pages.md). Checkout pages
also reveal open/asynchronous sessions with no invoice. They preserve raw
references and require host authorization, continuation checkpoints and
historical reconciliation; they do not attest complete history or award credit.

Custom recipient payout minimums are waived during the final day before the verified holding deadline. Provider limits and all financial checks still apply. See [settlement and deadline handling](settlement.md) for worker cadence, retries and expiry limitations.

Holding-expiry recovery remains visible and retryable after schedule restoration. The package preserves unresolved provider balances and payout claims, and prevents reset or custom reactivation from erasing them. See [expiry recovery](settlement.md) for operator handling.

Automatic payout status is reusable through `payoutAttemptStatus`, `payoutAttemptValidator`, and the React `PayoutAttemptStatus` workflow. Rejection reasons and retry times remain separate from eligibility previews and bank arrival dates. See [React workflow guidance](react-workflows.md).

Payout qualification renews source verification for the selected currency only after a complete matching provider-history check. Slower receipt scans retain the same freshness and local reservation safeguards; partial or changed history stays held. See [settlement guidance](settlement.md).

Automatic combined payouts use a complete paginated ledger collection above 100 historical sources or claims. The collection is checked and bound to the immutable claim before Stripe is contacted; incomplete scans resume without authorizing money. See [settlement guidance](settlement.md#resumable-local-collections).

Resolve recovery-backed payout liabilities with `stripe.costRecovery.payoutQuote(ctx, authorizedScope)` and pass its amount/version together to preview or automatic release. The example does this for seller refund/dispute costs; stale or missing required versions fail safely. See [versioned liability guidance](settlement.md#versioned-recovery-liabilities).

Historical payout adoption and funded-account activation also use complete paginated collections beyond the small direct snapshot path. They revalidate complete financial membership atomically, preserve paid principal and holding age, and reject stale funding or recovery changes. See [historical import guidance](settlement.md#historical-import-and-funded-activation).

## Metered usage

Metered billing is under investigation. See the [provider comparison and sandbox acceptance matrix](metered-usage.md) for current status and integration requirements. Public usage APIs are not available yet.

## Resources

- [Stripe V2 Accounts API](https://docs.stripe.com/connect/accounts-v2/api)
- [Stripe Embedded Checkout](https://docs.stripe.com/payments/checkout/custom)
- [Convex Component Authoring](https://docs.convex.dev/components/authoring)
- [Stripe Webhook Event Reference](https://docs.stripe.com/api/events/types)
- [Stripe Testing Guide](https://docs.stripe.com/testing)
- [Example checkout tests](https://github.com/FantasticDevHQ/better-stripe/blob/main/example/README.md#test-the-integration-examples), including successful payments, declines, insufficient funds, and 3D Secure
