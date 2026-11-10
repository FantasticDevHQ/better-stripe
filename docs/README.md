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
- [Testing utilities](testing.md), fixtures and mock webhook events.

## Billing and purchase history

- [Read contracts](read-contracts.md), pagination, currency summaries, and backfill.
- [Billing history](billing-history.md).
- [Invoice payment pages](invoice-payment-pages.md).
- [Checkout session pages](checkout-session-pages.md).
- [Captured Checkout payment observations](captured-checkout-payment.md), expanded provider evidence without fee or access authority.
- [Subscription payment methods](subscription-payment-methods.md).
- [SetupIntent recovery](setup-intent-recovery.md).
- [Balance funding state](balance-funding-state.md) and [workflow](balance-funding-workflow.md).
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

## Renewal price replacement

The public Node entrypoint can attach a schedule under the limited test-mode
profile documented below. Public configuration and provider-confirmed observation
remain unavailable, so attachment alone does not schedule a price change.
Guides marked internal describe modules without a public package export.

- [Public renewal attachment](renewal-attachment.md), host authorization, one provider write and journal readback.
- [Exact price replacement at renewal](renewal-price-replacements.md), the pure `prepareRenewalPriceReplacement` contract.
- [Context reads and attachment request preparation](renewal-context-reads.md), `readRenewalPriceReplacementContext` and `prepareRenewalScheduleAttachment`.
- [Compare renewal schedule material](renewal-material-observation.md), `inspectRenewalScheduleMaterialV2` over supplied reads.
- [Immutable renewal witness protocol](renewal-witness-protocol.md), component storage for unsigned renewal snapshots.
- [Renewal phase assembly](renewal-phase-assembly.md), internal classification and two-phase configure candidates.
- [Renewal preservation mappings](renewal-preservation-mappings.md), internal projection of provider read fields.
- [Raw renewal acquisition](renewal-raw-acquisition.md), internal reader for complete provider bodies.
- [Private renewal invoice acquisition](renewal-invoice-reads.md), internal invoice observer with no public export.
- [Renewal authorization in the example app](renewal-example-authorization.md), the host authorization used by integration tests.

## Architecture and upgrades

- [Component architecture](architecture.md), data ownership, trigger flow, and errors.
- [Component extraction](architecture/component-extraction.md).
- [Durable execution](architecture/durable-execution.md).
- [Recovery workflow architecture](architecture/recovery-workflow.md).
- [Migration guide](../MIGRATION.md).
- [Changelog](../CHANGELOG.md).

## Example application

The [example app setup guide](https://github.com/FantasticDevHQ/better-stripe/blob/main/example/README.md)
covers sandbox configuration, checkout comparisons, and test flows.

- [Example routing](example-routing.md), the TanStack Router route tree and shell.
- [Metered usage example](usage-example.md) and its [protocol diagnostics](usage-protocol-diagnostics.md).

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
- [Protocol diagnostics](usage-protocol-diagnostics.md), optional admin runs against isolated native Stripe resources.
- [Verification](usage-verification.md), packed consumers, native billing proof and documented limits.
- [Opt-in rollout](usage-rollout.md), adoption, drain, backfill limits, model transitions and rollback.

## Maintaining this repository

These documents are for contributors and maintainers of this repository. You do
not need them to install or use the package.

- [Development guide](development.md), local setup, quality gates, and code generation.
- [Pull request standard](pull-request-standard.md), title structure and required evidence.
- [Local example worktrees](worktrees.md) and [Stripe sandboxes for worktrees](stripe-sandbox-worktrees.md).
- [Release guide](releasing.md), publishing and release PR descriptions.
- [Component migration and release handoff](release-handoff.md), reviewed source surface and host cutover.
- [Example balance funding cutover](example-balance-funding-cutover.md) and [example recovery cutover](example-recovery-cutover.md), how the example app moved onto the component.
- [Example UI audit](react-workflows-audit.md), which package workflow backs each example page.
- [Maya's membership verification](maya-membership-verification.md), an end-to-end check of the example's demo membership.
