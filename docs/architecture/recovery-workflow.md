# Durable recovery groups

`stripe.costRecovery.startGroup` runs an already prepared and sealed recovery
group. The host authorizes the account, scope, currency, source and economic
allocation before starting. Settlement allocations must include the group's
exact signed recovery adjustment. The component pins the entire allocation and
rejects a different allocation, policy, callback, provider handle or API version
on replay. One settlement source can belong to only one workflow operation.
`requestKey` is an immutable identity within one BetterStripe component;
different callers must namespace their keys.

The host supplies an internal action reference as `provider`. Its validators
must accept `RecoveryProviderRequest`. Inside that action, call
`stripe.costRecovery.executeGroupProvider(ctx, args, {
stripeSecretKey: process.env.STRIPE_SECRET_KEY! })`. This options object exists
only during action execution. Never place credentials in `startGroup`, workflow
arguments, operation records, callback arguments or logs. The adapter constructs
a fresh Stripe client using the pinned API version and zero automatic network
retries. Existing `attachInvoice`, `reconcileInvoice`, settlement execution and
reserve/seal/finish APIs retain their behavior.

The provider action receives only a scoped operation reference, phase and pinned
versions. The adapter reads the immutable saved inputs and verifies an active
persisted dispatch before contacting Stripe. Its receipt echoes those references
and versions plus the source ID. A component bridge rejects unknown fields or
identity mismatches and sanitizes exceptions before returning a receipt to the
Workflow journal. It never persists provider response objects or messages.

Settlement execution reuses the existing transfer and affiliate allocation
ledger and its original idempotency keys. Reconciliation reads bounded transfer
history, mirrors verified transfers and confirms earnings without creating
missing transfers. Invoice execution reuses the original recovery invoice-item
key and item binding protocol. Invoice history is capped at 10,000 items;
incomplete history cannot authorize another write. The host still owns invoice
creation, finalization/payment policy, seller eligibility and reporting.
`releaseUncollectible` is an explicit immutable policy; paid invoices collect,
void invoices release, and uncollectible invoices release only when authorized.
Other invoice states retain the reservation.

`getGroupOperation`, `resumeGroup` and `requestGroupCancel` require the full saved
scope, operation ID and version. The SDK projects these fields from returned
statuses before invoking strict component validators. Only known readiness
observations receive automatic retries, at most `maxAttempts` (1–20) with the
explicit bounded `retryDelayMs`. An unknown provider effect waits for an explicit
`resumeGroup`, which performs reconciliation only. Missing transfers, ambiguous
history or failed reads never trigger new money writes or release reservations.

Each Workflow segment has at most 20 provider observations and 20 finish batches
(of at most 10 reservation operations each). `resumeGroup` continues an exhausted
or infrastructure-failed segment under the original operation and money keys.
A persisted verified receipt takes priority: continuation finishes the ledger
without contacting the provider. Failed receipt/finish/completion database steps
restart from the failed step while retaining earlier journaled results. No new
financial execution identity is allocated during resume.

An optional internal mutation `completion` runs after successful ledger finish.
It receives `RecoveryOperationStatus`, must perform database work only and must
use the operation ID/version as its projection identity. Its database changes
and the operation's completed status commit atomically. A callback failure can
be resumed without repeating the provider effect. It is a success callback;
cancellation does not invoke it.

Cancellation before provider dispatch stops execution and keeps the sealed
reservation. Cancellation during an action cannot undo the provider effect: a
verified success still completes collection and the callback, with
`cancelRequested: true`. An uncertain in-flight result keeps the reservation and
requires reconciliation. A canceled status therefore never means funds were
released. Hosts must retire their legacy orchestration for a group before using
this workflow; mixing independent executors defeats ownership of the operation.
