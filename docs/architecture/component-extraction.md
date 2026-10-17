# Component extraction and durable execution contracts

Status: design contracts, pending implementation and the nested-component
composition spike. These are proposed additive APIs, not shipped exports.
Reviewed against main `e9994a9` on 2026-10-17.
Implementation PRs must reference this decision and document changes to the
contracts before dependent work starts.

## Ownership decision

BetterStripe owns reusable Stripe protocols, provider verification, immutable
financial allocations, recovery reservations and durable operation state. The
host authenticates callers and selects business policy before invoking them.
Opaque host identifiers never imply authorization.

| Workstream                    | Package responsibility                                                                                           | Host responsibility                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Balance funding               | Persist restoration settings, serialize a subscription operation, apply and verify provider changes              | Authorize subscription/account, capture consent, choose enable/disable              |
| Recovery preparation          | Atomically reserve a bounded batch and seal when complete                                                        | Select same-currency scope, source and debit/credit policy                          |
| Settlement/recovery execution | Resume original allocations, reconcile provider receipts, finish existing ledgers                                | Select recipients, rates, eligible sales and uncollectible policy                   |
| Processing costs              | Verify original funding provenance, calculate an explicitly selected liability policy, reconcile claim revisions | Decide who owes retained processing/dispute costs                                   |
| Catalog, portal and accounts  | Typed Stripe calls, lookup-key adoption, scoped cache refresh, capability normalization                          | Tier names, product allowlists, proration/cancellation policy, merchant eligibility |
| Reporting and scheduling      | Bounded component readers and operation status                                                                   | User/store joins, entitlements, referral attribution, projections and cron cadence  |

Do not copy `storeSales`, `sellerCosts`, `storePlanCatalog` or `users` into the
component. Keep host IDs as strings only where needed for correlation. Never
parse `example:store:*`, role names or tier names in package code. Existing
settlement, transfer and cost-recovery tables remain the money ledger. A
workflow journal records execution progress, not a second balance.

## Public contract conventions

New methods live on domain clients and take `ctx` plus a validated options
object. Existing `costRecovery` methods and stateless `prepareBalanceFunding`
and `setBalanceFunding` remain available during migration. New orchestration
methods must not silently change their behavior or automatically enable preview
features. The following signatures specify the interfaces to implement.
Referenced existing types retain their definitions in the linked source files
below.

```ts
type OperationScope = {
  accountId: string;
  scopeKey: string; // Host-selected opaque correlation key.
};
type OperationRef = OperationScope & {
  operationId: string; // Durable, unique within this component installation.
  version: number; // Positive safe integer, not a queue attempt count.
};
type Unavailable =
  | {
      status: "not_ready";
      reason: "provider_pending" | "fee_pending" | "history_incomplete";
      retryable: true;
    }
  | {
      status: "conflict";
      reason: "scope_busy" | "revision_changed" | "identity_changed";
      retryable: false;
    }
  | {
      status: "rejected";
      reason: "invalid_scope" | "unsupported_source" | "policy_invalid";
      retryable: false;
    };
type OperationStatus = OperationRef & {
  state:
    "pending" | "running" | "unknown" | "succeeded" | "failed" | "canceled";
  cancelRequested: boolean;
  failureCode?: string; // Safe package code, never a raw provider message.
};
```

The shared outcomes workstream owns shared outcomes and adapters for existing
readiness types. Preserve existing result shapes; add explicit conversions where
needed. A caller handles `scope_busy` by reading the active operation, and
`revision_changed` by reading fresh state and asking policy to decide. They
never trigger blind action retries. Provider transport errors retain their
identity internally. A provider write with an uncertain outcome moves the
operation to `unknown`; it is not a successful, rejected or canceled money
movement. Exhausted bounded history stays unknown.

The additive SDK adapters return `FinancialOutcome<T>`, with ready data in
`value`, and preserve existing reader result shapes. The shared
`FinancialUnavailable` contract extends the examples above with terminal
`payment_not_payable` and `currency_mismatch` reasons. It also exposes
`unknown/provider_outcome_unknown` and `unknown/history_incomplete`, both
nonretryable. Unknown writes require reconciliation, including after bounded
history exhaustion. The pure retry decision accepts only validated pending
outcomes and explicit limits. See [financial readiness](../read-contracts.md#financial-readiness-and-bounded-retries).

Derive account, subscription, invoice and source identities on the server.
Validate complete immutable arguments on every replay, including currency,
target, provider version and policy snapshot. Status/cancel lookups must match
the saved account and scope; an operation ID alone never selects a foreign
scope. All amounts and revisions use checked safe integers. A missing fee is not
zero. Reject mixed currency and unsupported funding provenance before reserving
or transferring money.

## Balance-funding state and execution

The funding state workstream owns component state under
`src/component/balanceFunding/`; the funding workflow workstream owns provider
orchestration and its domain client. Use these additive method contracts:

```ts
// Server-only. preparation is the existing BalanceFundingPreparation type.
balanceFunding.prepare(ctx, {
  accountId,
  scopeKey,
  stripeSubscriptionId,
  consent: true,
  requestKey,
}); // => OperationStatus | Unavailable, saves intent before provisioning
balanceFunding.savePreparation(ctx, {
  accountId,
  scopeKey,
  preparation,
  consentAt,
}); // => { preparationId: string }, exact replay returns the same record
balanceFunding.begin(ctx, {
  accountId,
  scopeKey,
  preparationId,
  enabled,
  consent,
  requestKey,
}); // => { status: "accepted", operation: OperationRef }
// or { status: "unchanged", enabled } or Unavailable
balanceFunding.start(ctx, { ...operation }); // => OperationStatus
balanceFunding.getOperation(ctx, { ...operation }); // => OperationStatus | null
balanceFunding.requestCancel(ctx, { ...operation }); // => OperationStatus

type PreparationLookup =
  | {
      status: "prepared";
      operation: OperationRef;
      stripeSubscriptionId: string;
      preparationId: string;
    }
  | {
      status: "pending" | "running" | "unknown" | "failed" | "canceled";
      operation: OperationRef;
    };
balanceFunding.getPreparation(ctx, {
  ...operation, // Account, scope, operation ID and version are all required.
  stripeSubscriptionId,
}); // => PreparationLookup | Unavailable | null

balanceFunding.findPreparationOperation(ctx, {
  accountId,
  scopeKey,
  stripeSubscriptionId,
  requestKey,
  providerApiVersion,
  consent: true,
}); // => OperationStatus | Unavailable | null; read-only request recovery
```

`getPreparation` reads the result of an existing preparation operation. It never
provisions a payment method or captures restoration settings. It validates the
saved account, subscription, scope, operation ID and version together; an
existing foreign or contradictory binding returns `invalid_scope` or
`identity_changed`, never a foreign preparation reference. `null` means no
matching operation was found, not proof that a provider write did not happen or
permission to start a new one. Pending, running, unknown, failed and canceled
results expose no preparation ID. Only a successfully verified and durably
saved preparation returns `prepared`, with the original server-owned ID.
Replays keep that result stable. Status and lookup results expose neither
restoration settings nor credentials.

Before recapturing provider settings or consent time, the runtime queries
`findPreparationOperation` with the original public request key. It validates
saved prepare-kind, account, scope, subscription, API version and consent binding,
returning only safe operation identity/state. Unknown or failed intents retain
their original identity; a new key never permits recapturing already-enabled
restoration or replacing unresolved preparation. A null lookup is not proof that
no provider effect happened. Full low-level captured snapshots remain immutable.

If a prepare response is lost, repeat `prepare` with the original request key
and unchanged payload to recover the same operation, then call `getPreparation`
for its reference. Hold pending or unknown work and reconcile that operation;
do not create another payment method. Pass the returned preparation ID to
`begin`. `begin` independently validates its saved account/subscription binding
and verified state before accepting the new setting intent. A browser-supplied
ID alone proves neither ownership nor readiness. `savePreparation` remains the
explicit path for verified legacy imports, not the new preparation handoff.

`accountId` must equal the preparation's `customerAccount`; scope identifies one
subscription. Enforce one active operation per account/subscription even if a
host supplies a different scope alias. The component validates that binding and
refuses conflicting preparation data. Capture original payment-method ID and
payment-method types once, including null versus empty values. Never recapture
restoration settings from an already enabled subscription. A changed
subscription needs an explicit new preparation after the old operation is
reconciled, not an overwrite.

`requestKey` identifies one host intent. The component binds it to the complete
payload. The same request returns the same operation even after completion; a
changed payload conflicts. A completed disable followed by a new enable uses a
new request key and operation version. Same-target calls while pending reuse the
active operation; opposing targets conflict. An already satisfied state may
return unchanged only when no unresolved operation exists.

Begin durably before any provider write. Persist a stable provider key per
phase, including prepare/create/attach and apply/enable/disable. Preparation
provisioning also needs a durable intent before provisioning so a lost prepare
response cannot create another payment method. The `prepare` entry point owns
that intent and saves the original settings before create/attach. Keep
`savePreparation` for verified legacy records. Replays use the saved restoration
and request snapshot.

The completion mutation compares operation identity, version, target and
provider receipt before updating the setting. An old action cannot finish a
newer version. If Stripe succeeds but the finish mutation fails, read current
subscription and payment-method ownership and reconcile the same operation.
External changes that match neither original nor intended settings produce an
explicit conflict. A configured preview API version is required at prepare and
apply time. A runtime must carry the selected API version and request scope
through all action steps. The runtime composition workstream must prove a
supported credential execution boundary. Do not assume a nested component can
read host environment variables. One supported design may invoke a host provider
action reference that creates the SDK from runtime host environment and returns
only a nonsecret validated receipt. If component-local credential access is
unsupported, keep ledgers and orchestration component-owned while provider steps
run in those host actions. Redact secrets from action results, durable
arguments, journals, status and logs. Never persist Stripe secrets in workflow
arguments or copy them into operation state.

## Atomic recovery preparation

The recovery preparation workstream adds the following method to the existing
cost-recovery client:

```ts
costRecovery.prepareGroup(ctx, {
  ...groupOptions, // Existing RecoveryGroupOptions, including currency and limits.
  limit: 100, // Optional, same bounded validation as reserve.
});
// => { status: "prepared", group, isDone: boolean } | Unavailable
```

Each invocation runs one component mutation. It checks immutable group identity
and active-scope ownership, derives the next reservation identity, reserves at
most the permitted batch and seals only when the target equals the reserved
amount. A sealed group's replay returns the original group with `isDone: true`.
An open group returns `isDone: false` until another bounded invocation
completes. Do not derive batch IDs in host code from an independently read
`pendingOperations`. Persist or derive a monotonic batch sequence in the atomic
mutation; empty batches and finished reservations cannot recycle an old ID.

Preserve the existing signed accounting equation for each claim and balance:
`amountDue = collectedAmount + reservedAmount + outstanding`. Claim updates use
revision checks. Group identity, source gross/fees, currency and debit/credit
limits cannot change on retry. The active group excludes another boundary for
the same account/scope/currency through transactional state, not queue
concurrency. A foreign active group returns `scope_busy`. The host may choose to
defer recovery for an otherwise eligible sale; the package never chooses that
business policy.

The recovery workflow workstream adds `costRecovery.startGroup(ctx, { ...scope,
groupKey, requestKey, releaseUncollectible })` returning `OperationStatus |
Unavailable`. Preparation must finish before execution. Resolve the source kind
from the sealed group; never infer it from metadata strings. The settlement
caller provides its separately pinned allocation to existing settlement
execution, including the sealed recovery adjustment. Verify the same group's
scope and authorized adjustment before use. Invoice collection reuses
`attachInvoice` and `reconcileInvoice`. Preserve the explicit uncollectible-
release policy and bounded `finish` continuation. A failed workflow never
automatically releases an uncertain reservation.

The provenance resolver workstream resolves original
invoice/payment/subscription/price provenance with bounded complete provider
history and typed unavailable outcomes. Reject partial or ambiguous funding
instead of guessing. The explicit-policy pure deficit helper requires explicit
liability and rounding policy. The processing-cost reconciliation workstream
uses both in revision-guarded cost claim reconciliation and retains the original
recovery receipt for rollback. Current tier prices, affiliate rates or webhook
arrival order cannot rewrite an original allocation or prove original funding.

## Durable execution decision and composition exit gate

Use [Workflow](https://github.com/convex/workflow) for multi-step funding and
recovery sequences. Keep handlers deterministic and perform provider I/O in
action steps. Workflow already uses Workpool for step scheduling. Add a separate
[Workpool](https://github.com/convex/workpool) only for independent bounded jobs
that need their own concurrency/retry policy. Avoid double-queueing each step.

The runtime composition workstream must demonstrate nested installation inside
BetterStripe with pinned compatible versions, generated references, credential
access/API-version propagation, start/status/cancel and nested-component test
registration. Until those checks pass, this is an implementation choice to
validate, not a compatibility claim. If composition fails, document the specific
failure and revise this decision before adding a host-owned execution service or
starting dependent workflows.

A pool-wide concurrency cap is capacity control. Component scope claims provide
serialization. Stripe writes still need stable keys, authoritative
reconciliation and existing financial ledgers. Retry only classified transient
or explicitly not-ready steps with bounded attempts/backoff; do not retry every
financial action by default. Never generate new money-operation IDs in a retried
step.

Cancellation stops future work where possible. An in-flight action can complete.
Record `cancelRequested` separately, then reconcile its receipt before reporting
terminal `canceled`. Completed provider effects remain ledger facts;
cancellation is not refund, reversal or reservation release. Unknown work keeps
its scope claim until reconciliation. Resume/restart keeps the original
operation and phase keys. A new workflow-run ID is never permission to repeat a
provider effect.

Persist definition version with operation state. Retain executable old
definitions until their operations finish or migrate through a tested compatible
transition. Reject incompatible resumes. Cleanup may remove terminal execution
history only after durable receipts and replay identities survive elsewhere;
never delete financial ledgers or key bindings to satisfy workflow retention
limits.

## Migration and rollback

The funding cutover workstream imports balance-funding preparations and active
operations in bounded, idempotent pages. Preserve original restoration values,
operation version, consent, target and pending state. Preserve exact legacy
provider keys, including `example_balance_${subscriptionId}_${version}` and
their phase suffixes. Preserve `example_balance_prepare_${subscriptionId}` for
interrupted legacy preparation. A new namespace is safe only for genuinely new
operations. An unknown legacy operation requires reconciliation before switching
writers.

The financial cutover workstream reuses `costRecovery.importClaim` for verified
opening collections and preserves original claim/group/operation identities.
Imports use stable source keys and immutable payload comparison. An exact page
retry is a no-op; conflicting scope, amounts or receipts fail without partial
writes. Never import a live claim as a new opening balance. Host
authorization/mapping runs before imports. Use server-side checkpoints and per-
scope reconciliation, not a browser cursor, as migration evidence. Keep host
reporting projections replay-safe by source identity.

For every scope: pause old entry points that start new effects, retain authorized
receipt reconciliation and finish for existing operations, reconcile in-flight
operations, import and verify state, then enable one new writer. Reconciliation
must retain the original operation and phase keys; it cannot start a replacement
effect or admit a new intent. Retire the remaining old mutation entry points
only after the verified handoff accounts for their operations. Queries may
read projections, but never sum old and new balances. Record migration version
and source checkpoint. Do not delete legacy restoration/provenance until
rollback and retention needs end. Rollback first stops new starts, drains or
reconciles pending work and establishes one owner. Restore old writers only
after a tested reverse mapping supports new state. Reverting code alone is
unsafe after new operations exist.

## Parallel implementation and integration

Each agent claims its ticket, uses an isolated `codex/<issue-number>-<slug>`
worktree, and starts dependent work only after blockers merge. Domain agents own
their client/component domain files, schema fragments and co-located tests. Host
cutover agents own their specified example domains. The contracts workstream
owns this ADR; the shared outcomes workstream owns shared outcome definitions.
Resolve interface changes here before implementing incompatible callers.

The coordinator is the shared-file integration owner. Serialize edits to
`src/client/index.ts`, `src/component/schema.ts`,
`src/component/convex.config.ts`, package manifests/lockfile and
`_generated/**`. Domain PRs propose minimal shared patches and coordinate them
before pushing. Integrate each domain's exports and registration with its
implementation, before dependent cutovers. The release workstream performs final
consolidation, not the first registration of earlier APIs. Generate types
through actual codegen; never hand-edit generated files. Do not publish npm or
operate live money as part of these implementation tickets.

## Required acceptance evidence

The following are behavioral fixtures for implementation tests, not a new
parallel model of production state. Domain PRs turn the relevant rows into tests
against real component mutations/actions. The integration verification
workstream verifies their combined behavior.

| Fixture                                                   | Required observation                                                                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Same request key and payload arrives twice                | One operation, one original payload, same phase keys                                                                            |
| Prepare response is lost after successful provisioning    | Replay finds the same operation; scoped lookup returns the original preparation ID; begin uses it without another create/attach |
| Preparation lookup is pending, unknown or foreign         | No preparation reference or new provider effect; pending/unknown holds and foreign scope rejects                                |
| Same key with a different account, currency or target     | Conflict before provider mutation                                                                                               |
| Enable pending, then disable requested                    | Scope remains owned by enable; disable conflicts                                                                                |
| Stripe applies enable, component finish fails             | Replay verifies provider state and finishes the original version                                                                |
| Old action finishes after another version                 | No newer setting or ledger update                                                                                               |
| Recovery needs 101 claims at batch limit 100              | Two bounded calls, distinct reservation IDs, one sealed target                                                                  |
| Empty reservation or already finished group replay        | No reused batch identity, extra collection or release                                                                           |
| Two recovery groups compete for one scope                 | One active boundary; loser receives scope_busy                                                                                  |
| Cancellation races a successful provider call             | Receipt reconciled; successful money effect retained                                                                            |
| Queue retry occurs after provider key retention expires   | Verify full authoritative receipts or hold unknown; never blind recreate                                                        |
| Migration page retries or conflicts                       | Exact replay is a no-op; conflict rolls back the page                                                                           |
| Migration pauses starts with an in-flight provider result | New effects stay paused while original receipt reconciliation and finish remain authorized                                      |
| Legacy funding is enabled with original card settings     | Import preserves card restoration and pending provider key                                                                      |
| Definition upgrade resumes an old operation               | Compatible old definition runs or explicit hold; no effect replay                                                               |
| Provider history is partial, multi-funded or foreign      | Explicit unavailable/rejected result; no inferred zero or guessed source                                                        |

Run `pnpm run check:all` for every implementation handoff. Preserve all gate
floors and budgets. Put sanitized logs/results directly in each ready PR and
report unavailable provider/deployment checks honestly. Unit mocks cannot
establish live Stripe eligibility or nested deployment compatibility. Require
sandbox integration evidence for those claims before consumer cutover.

## Current source anchors

- [Funding provider protocol](../../src/client/billing/balanceFunding.ts) and
  [example pending-operation mutations](../../example/convex/storeBalance/funding/internal/mutations.ts).
- [Recovery client](../../src/client/costRecovery.ts),
  [reservation and sealing mutations](../../src/component/costRecovery/reservations.ts),
  [sale preparation](../../example/convex/settlement/recovery.ts) and
  [invoice preparation](../../example/convex/sellerCosts/recoveryInvoices/mutations.ts).
- [Settlement execution](../../src/client/settlement/execution.ts) and
  [existing public settlement contract](../settlement.md).
- [Component environment configuration](../../src/component/convex.config.ts) and
  [existing read/provider contracts](../read-contracts.md).
