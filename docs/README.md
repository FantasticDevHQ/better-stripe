# Documentation

Start with the [package quick start](../README.md#quick-start), then choose the
guide for your integration.

## Setup and API references

- [Package overview](overview.md), capabilities, known limits, and Accounts v2 compatibility.
- [Accounts v2 customer preview](accounts-v2-preview.md), eligibility and webhook migration.
- [Configuration](configuration.md), environment variables, component wiring, and API versions.
- [Client API reference](client-api.md), server methods, intent creation, and recovery claims.
- [Webhooks and triggers](webhooks.md), destinations, supported events, and callbacks.
- [React API reference](react-api.md), hooks, providers, and headless components.
- [React workflows](react-workflows.md), integration examples and host responsibilities.
- [React workflow audit](react-workflows-audit.md), UI reuse and coverage.

## Billing and purchase history

- [Read contracts](read-contracts.md), pagination, currency summaries, and backfill.
- [Billing history](billing-history.md).
- [Invoice payment pages](invoice-payment-pages.md).
- [Checkout session pages](checkout-session-pages.md).
- [Subscription payment methods](subscription-payment-methods.md).
- [SetupIntent recovery](setup-intent-recovery.md).
- [Balance funding state](balance-funding-state.md) and [workflow](balance-funding-workflow.md).
- [Example balance funding cutover](example-balance-funding-cutover.md).
- [Metered usage investigation](metered-usage.md), provider comparison and acceptance requirements. Shared contracts, catalog provisioning and local usage acceptance are available; credit accounting is in progress.

## Marketplace, settlement, and recovery

- [Marketplace economics](marketplace.md), fees, splits, refunds, and disputes.
- [Settlement and payouts](settlement.md), verified receipts, payout policies, and automatic workers.
- [Affiliate commission clawbacks](affiliate-clawbacks.md).
- [Refund context](refund-context.md) and [refund command evidence](refund-command-evidence.md).
- [Processing cost reconciliation](processing-cost-reconciliation.md).
- [Personal account mapping](personal-account-mapping.md).
- [Financial ownership](financial-ownership.md) and [financial observations](financial-observations.md).
- [Example recovery cutover](example-recovery-cutover.md).

## Architecture and contributing

- [Component architecture](architecture.md), data ownership, trigger flow, and errors.
- [Component extraction](architecture/component-extraction.md).
- [Durable execution](architecture/durable-execution.md).
- [Recovery workflow architecture](architecture/recovery-workflow.md).
- [Development guide](development.md), local setup, quality gates, and code generation.
- [Testing utilities](testing.md), fixtures and mock webhook events.
- [Release guide](releasing.md), publishing and release PR descriptions.
- [Migration guide](../MIGRATION.md) and [release handoff](release-handoff.md).
- [Changelog](../CHANGELOG.md).

The [example app setup guide](https://github.com/FantasticDevHQ/better-stripe/blob/main/example/README.md)
covers sandbox configuration, checkout comparisons, and test flows.

## Metered usage

Start with the [native Stripe setup guide](metering-setup.md), then read the
[shared contracts and sandbox evidence](metered-usage.md).

[Atomic usage ledger and scoped history](usage-ledger.md) describes acceptance and retention.

[Native usage catalog](usage-catalog.md) covers provisioning, immutable versions and typed price observations.

[Durable native delivery](usage-delivery.md) explains host actions, bounded retries, operational holds and asynchronous errors.

[Usage observations and reconciliation](usage-observations.md) covers exact summaries, paginated audit history, native freshness and invoice observations.

[Managed metered subscriptions and invoice lifecycle](usage-subscriptions.md) covers all three models, Checkout, renewal, closeout and native test clocks.

- [Payment-backed prepaid usage](./usage-credits.md)

- [Included usage and limits](./usage-limits.md) covers atomic caps, reservations, period resets and exact overage estimates.

- [Usage corrections](./usage-corrections.md) covers native cancellation, quantity restoration and verified invoice adjustments.

- [Native usage settlement](./usage-settlement.md) covers original paid invoices, issuer-service credit purchases and affiliate recovery.

- [Metered billing authorization](./usage-security.md) covers server ownership, work deduplication, native proof limits and retained recovery liabilities.

- [Reusable metered billing UI](usage-react.md) covers all three models, render props, authenticated adapters and bounded history.

- [Native usage configuration UI](usage-configuration.md) covers reusable forms, managed meter selection, price rows and authorized adapters.
