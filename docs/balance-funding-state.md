# Durable balance-funding state

The `balanceFunding` component domain implements the persistence boundary from
[the extraction contract](architecture/component-extraction.md). It stores opaque
host scope, verified original payment settings, consent reference and timestamp,
provider API version, operation identity/version, phase keys, receipts and pending
target. Host code authenticates callers, authorizes the account/subscription,
captures consent and selects policy before invoking any component method.

This domain does not call Stripe or run a workflow. Provider orchestration and
preview-version opt-in remain the funding workflow workstream. No credentials
belong in scope keys, consent references, provider receipts, durable arguments or
operation state. The component's tables are an execution journal, not a money
ledger.

## Preparation and immutable intent

The low-level `mutations.prepare` takes the verified original settings in
`preparation` without a balance payment-method ID, plus `accountId`, `scopeKey`,
`consent: true`, `consentAt`, `consentReference`, `providerApiVersion` and
`requestKey`. The runtime must obtain these settings before any create/attach
write. This persists a pending preparation operation and stable `providerKey`
and create/attach phase keys. The runtime never recaptures original settings
from an already-enabled subscription.

`finishPreparation` accepts the complete operation reference, verified preparation
including the new payment-method ID, and the same provider API version. It checks
the captured restoration settings and active version before saving the result.
Null and empty restoration values remain distinct. Exact completion is idempotent;
a contradictory result rejects. A canceled or stale operation cannot finish.

The host-facing preparation lookup is `queries.getPreparation`: pass account,
scope, subscription, operation ID and version. Only a succeeded preparation
operation returns `status: "prepared"` and its original preparation ID. Pending,
running, unknown, failed and canceled results expose only operation identity and state,
with an optional safe failure code.
Foreign or contradictory bindings return an explicit unavailable outcome. Missing
operations return null, which does not authorize another provider effect. Recover
a lost prepare response by replaying its original request key and payload, then
looking up that same operation.

## Apply, inspect and cancel

`begin` accepts the saved preparation ID, account/scope, desired `enabled`,
explicit enable consent and a request key. New request keys bind the full payload;
replaying one returns the original result even after completion. A changed payload
conflicts. Same-target pending intents reuse the active operation; opposite targets
conflict. A scope alias cannot acquire a second preparation or evade the
account/subscription boundary. New versions are positive safe integers.

`start` transitions pending work to running before provider execution. Repeated
start of running or unknown work does not establish permission to repeat an effect.
`markUnknown` retains the active claim when the provider outcome is uncertain.
`finish` checks operation identity, version, target, account/subscription, API
version and exact observed payment settings before updating enabled state.
A repeated old completion returns its original receipt without changing a newer
setting. Provider reconciliation remains necessary after transport uncertainty.

`requestCancel` cancels unstarted work and releases its claim transactionally.
For running/unknown work it records `cancelRequested` and retains the claim until
the original provider result is reconciled. A successful effect remains succeeded
even when cancellation was requested. Cancellation never restores payment settings
or reverses a provider effect by itself.

`getOperation` returns safe identity/state/cancellation fields. The server-only
`readPreparation` and `inspectOperation` queries return restoration data or phase
keys for trusted provider actions. They require the saved account, scope and
subscription; operation inspection also requires operation ID/version. Never
forward those raw records or receipts to browser-facing queries. Status/lookup
results contain no restoration settings or credentials.

`failBeforeStart` records a terminal `failed` state only while the intent is still
pending, before provider execution begins. It accepts only `invalid_scope`,
`unsupported_source` or `policy_invalid`, never a provider message. The same
request replay retains the failed operation; a fresh intent gets a new version
and phase keys. Running and unknown operations cannot use this transition or
release their claim. It does not classify provider exceptions or prove no effect
after provider execution has begun; those paths require reconciliation. Status
and preparation lookup expose the safe code without restoration data.

## Import and migration pause

`savePreparation` is for verified complete legacy preparations. Exact replay
returns the existing ID; changed restoration, scope, consent or API version
rejects. It does not overwrite existing records.

`importPreparation` also preserves the legacy enabled state, operation version,
pending target and exact provider base key. Its source key binds the complete
import payload. Exact replay remains a no-op after the imported operation has
advanced; changed imports reject transactionally. A different source cannot
replace an existing account/subscription record.

Imported pending operations start unknown and paused. Pending preparation imports
use `pending.kind: "prepare"` and may omit the balance payment-method ID. Preserve
`example_balance_prepare_${subscriptionId}` for their base key and its create/
attach suffixes. Pending apply imports preserve
`example_balance_${subscriptionId}_${version}` and enable/disable suffixes. Never
replace a legacy key with the new-operation namespace.

`setStartsPaused` blocks new intents and pending-to-running transitions while
keeping original status, cancellation, receipt reconciliation and completion
available. Imports begin paused; resume starts only after stopping the old writer
and checking the imported state. A paused replay can recover an existing intent,
but cannot authorize a new provider effect. Pause old starts rather than disabling
finish handlers needed to reconcile in-flight receipts. Rollback requires one
writer and verified state; reverting code alone cannot undo provider effects.
