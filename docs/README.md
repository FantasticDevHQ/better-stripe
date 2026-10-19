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
- [Metered billing guides](#metered-usage), all three models, package APIs, runnable examples and rollout.

## Marketplace, settlement, and recovery

- [Marketplace economics](marketplace.md), fees, splits, refunds, and disputes.
- [Settlement and payouts](settlement.md), verified receipts, payout policies, and automatic workers.
- [Affiliate commission clawbacks](affiliate-clawbacks.md).
- [Refund context](refund-context.md) and [refund command evidence](refund-command-evidence.md).
- [Processing cost reconciliation](processing-cost-reconciliation.md).
- [Personal account mapping](personal-account-mapping.md).
- [Financial ownership](financial-ownership.md) and [financial observations](financial-observations.md), including claimed reversal history.
- [Payout revision migration](payout-revision-migration.md), explicit bounded activation before large reversal operations.
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

- [Native Stripe setup](metering-setup.md), prerequisites, safe credentials and the developer/AI-agent runbook.
- [Three-model recipes](metered-usage.md), developer-defined units, rates, allowances and paid prepaid credits.
- [Atomic ledger and history](usage-ledger.md), acceptance, event identity and retention.
- [Native usage catalog](usage-catalog.md), provisioning, immutable versions and typed price observations.
- [Durable delivery](usage-delivery.md), internal provider actions, bounded retries, holds and asynchronous errors.
- [Observations and reconciliation](usage-observations.md), exact summaries, paginated history, freshness and invoices.
- [Managed subscriptions](usage-subscriptions.md), enrollment, Checkout, renewal, closeout and native test clocks.
- [Payment-backed prepaid credits](usage-credits.md), verified purchase grants, consumption and recovery.
- [Included usage and limits](usage-limits.md), atomic caps, reservations, period resets and overage estimates.
- [Corrections](usage-corrections.md), native cancellation, quantity restoration and verified invoice adjustments.
- [Settlement](usage-settlement.md), original paid invoices, issuer-service credit purchases and affiliate recovery.
- [Authorization](usage-security.md), server ownership, work deduplication and retained liabilities.
- [React workflows](usage-react.md), all three models, render props, authenticated adapters and bounded history.
- [Configuration UI](usage-configuration.md), reusable forms, managed meter selection and price rows.
- [Runnable example](usage-example.md), three sandbox flows, paid evidence and scoped cleanup.
- [Verification](usage-verification.md), packed consumers, native billing proof and documented limits.
- [Opt-in rollout](usage-rollout.md), adoption, drain, backfill limits, model transitions and rollback.
