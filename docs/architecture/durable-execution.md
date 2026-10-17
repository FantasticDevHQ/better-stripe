# Nested durable execution

**Compatibility change:** consumers using Convex below 1.46.0 must upgrade
before adopting this change. The previous peer range started at 1.29.3. Public
BetterStripe methods are preserved, but that older runtime range is no longer
claimed as supported. This change does not publish a release or alter a tag.

BetterStripe installs Workflow 0.4.10, which installs Workpool 0.4.14 and Batch
Worker 0.2.2. Convex 1.46.0 or newer and convex-helpers 0.1.127 or newer are
required by these packages. BetterStripe's Convex peer minimum is now 1.46.0.
The direct Workflow and Workpool dependencies are pinned so library behavior
changes require an explicit package update and verification.

`src/component/durableExecution/runtime.ts` exports `executionWorkflow`, bound
to the generated `components.workflow` reference. Its pool runs at most two
steps concurrently and does not retry actions automatically. Domain workflows
can define versioned internal mutations using this manager. The initial runtime spike added no public financial endpoints. The merged
domain workflows now expose the APIs described in the [release handoff](../release-handoff.md).
Existing scheduled jobs are not migrated automatically.

Workflow already schedules its handler and steps through its own Workpool.
Do not enqueue those steps in another pool. A standalone Workpool is appropriate
for an independent job that needs bounded concurrency and a completion callback
but has no multi-step journal or replay dependency. The tests install an extra
pool only to compare that execution model. Production installs one Workflow
child, with its own pool, and no sibling pool.

## Version comparison

The installed package manifests declare these peer requirements:

| Package         | Convex peer | Workpool peer        |
| --------------- | ----------- | -------------------- |
| Workflow 0.4.10 | `^1.46.0`   | `^0.4.4`             |
| Workpool 0.4.14 | `^1.36.1`   | n/a                  |
| Workflow 0.4.4  | `^1.36.1`   | `^0.4.4`             |
| Workflow 0.3.12 | `^1.31.7`   | `^0.3.0 \|\| ^0.4.0` |
| Workflow 0.3.4  | `^1.24.8`   | `^0.3.0`             |
| Workpool 0.3.1  | `^1.24.8`   | n/a                  |

Workflow 0.3.4 with Workpool 0.3.1 could accept the old Convex minimum by
manifest alone. It does not provide the selective failed-step restart required
by the saved-receipt replay scenario. Its published test registration also
registers Workpool at the root rather than beneath the named Workflow. The
[Workflow changelog](https://github.com/get-convex/workflow/blob/main/CHANGELOG.md)
records selective restart in 0.3.6 and corrected nested registration in 0.3.9;
those versions require Convex 1.31.7 or newer. Consequently, the older pair does
not preserve the required semantics and verifiable nested test boundary.

Choose the current 0.4.10/0.4.14 pair, matching the repository's installed Convex
1.46.0. This also includes subsequent workflow argument-validation, cleanup and
test-isolation fixes. The [Workpool changelog](https://github.com/get-convex/workpool/blob/main/CHANGELOG.md)
records newer recovery-race and bounded batch-processing fixes. Older manifests
do not establish an ongoing maintainer support guarantee; no such guarantee is
assumed here. The comparison uses published package manifests/source and the
maintainers' changelogs, not a claim that old providers were live-tested.

## Credentials and provider versions

Use a host internal action as the provider boundary. Create its serializable
reference with `createFunctionHandle` in an authorized host mutation or action.
Pass that handle and the nonsecret operation scope to the component. The action
creates the Stripe SDK from its runtime environment and the operation's explicit
API version, then returns a validated, nonsecret receipt. Pass the saved Stripe
account or context explicitly to every provider request. Host authorization and
server-derived scope checks must run before creating an operation or selecting
the provider action.

Workflow handlers run in a deterministic environment that disables direct
access to `process`, `fetch` and cryptography. Never read credentials in a
workflow handler, and never copy secrets into workflow arguments, action
arguments, journals, completion context, results, status or logs. Persist only
provider identities, phase keys, versions and validated receipts needed for
reconciliation. Provider actions must redact their errors too; Workflow records
failure text. The test transport records whether authorization matched, never
its value.

The component already declares and receives its Stripe environment variables.
A local push and `core/queries:getStripeMode` invocation confirmed that declared
environment forwarding works. This does not grant a workflow handler environment
access. Host action handles provide an explicit, tested credential boundary and
also let the host select supported provider configuration without placing keys
in durable state.

## Replay, retries and cancellation

A successful action step has a saved result. When a later persistence step
fails, restart from that failed step, preserving the earlier provider journal.
The integration test restarts from the persistence mutation reference and proves
that the provider action runs once while persistence runs twice. A default
restart preserves recorded failed steps as well; it does not erase their
failure. Never restart from step zero to recover a financial operation.

This journal behavior does not guarantee exactly-once Stripe effects. If Stripe
applies a request but the action result is lost before journaling, the operation
owner must reconcile provider state and reuse its saved phase key. An execution
failure does not establish a rejected financial outcome. Unknown effects retain
reservations until reconciled. The runtime deliberately has no generic automatic
provider-write retry policy. Provider action implementations must also explicitly
configure the Stripe SDK network retry setting for their phase. The fixture uses
`maxNetworkRetries: 0`; disabling Workflow retries alone would not disable the
SDK's own retries. Its ambiguous transport test loses the response after the
request and asserts only one SDK transport attempt.

The explicit two-attempt retry test uses a read-only Stripe operation and an
opt-in step policy. It proves the configured attempt cap, not permission to retry
financial writes. Domain retry adapters must follow the financial readiness
contract: only a retryable `not_ready` result may trigger a capped retry. A thrown
provider error or unknown effect requires reconciliation, not blind re-execution.

Cancellation can stop future steps but cannot abort a provider call already in
flight. The cancellation-race test releases an in-flight provider action after
canceling the workflow; the transport completes, workflow status stays canceled,
and the later persistence step does not run. Domain operation state must record
and reconcile that possible effect. Workflow cancellation is neither a refund
nor proof that no money moved.

Completion callbacks record success, failure or cancellation. A restart can
produce another completion for the new execution generation. Callbacks must
therefore compare operation identity/version and apply financial changes
idempotently. Execution cleanup removes Workflow history, not financial receipts
or operation-key bindings. The test keeps its separate receipt and completion
records after cleaning execution history. Production retention must wait until
operation reconciliation and the domain's retention policy permit cleanup.

## Definition versions and retention limits

Workflow does not pin an old JavaScript implementation automatically. Store a
positive definition version and the immutable provider/API-version snapshot in
the domain operation. Route resumes to compatible, retained internal definitions
such as `applyV1`; keep those exports executable while their operations can
resume. Keep host provider action exports and compatible receipt schemas for the
same lifetime: a function handle does not pin an old action implementation. Do
not rewrite an old definition to use a new API version or phase key.
The changed-definition test changes action arguments during replay and verifies
that Workflow refuses the journal mismatch before making another provider call.
The original API version and receipt remain in saved history.

An incompatible definition must leave the financial operation held for
reconciliation. Its failed execution status alone does not release reservations
or permit a fresh provider attempt. Cleanup also cannot make the old provider
effect safe to repeat: the retention test proves restart fails after cleanup,
while its separate receipt and completion records remain. Once journal retention
expires, the domain must use retained operation/receipt evidence and provider
reconciliation, not recreate the workflow and replay effects. The shared runtime
binding supplies neither domain identity/version guards nor retention policy;
those remain mandatory work in each financial workflow cutover.

## Reproducing verification

Run the focused behavioral suite:

```sh
VITEST_MAX_WORKERS=1 pnpm exec vitest run src/component/durableExecution/composition.test.ts
```

It uses the published Workflow, Workpool and Batch Worker test registrations
nested under a BetterStripe component. Host action references cross the component
boundary through `createFunctionHandle`. The real Stripe SDK constructs requests;
only HTTP transport is replaced. Tests cover explicit version/account headers,
credential isolation from durable state, saved-receipt replay, configured retry
limits, unknown effects, cross-workflow concurrency, cancellation races,
completion retention, and an independent queue.

Use a dedicated development deployment or a verified, isolated project-local
anonymous deployment for installation checks. Before any `dev`, environment or
`run` command, inspect the selected project-local configuration and confirm its
identity, data ownership and unused ports. A fresh directory alone is not proof
of isolation: the CLI can fall back to shared home-directory anonymous state.
Do not use generic `CONVEX_AGENT_MODE=anonymous` as an isolation guarantee.

For an already verified project-local deployment, keep the explicit deployment
selector in a private env file and supply it on supported commands. Run commands
from the owning app directory. For example, after verification:

```sh
node node_modules/convex/bin/main.js dev --env-file /absolute/private/local.env --once --typecheck disable --local-cloud-port 3260 --local-site-port 3261
# Only on that verified fixture deployment, set a dummy key if required:
node node_modules/convex/bin/main.js env set STRIPE_SECRET_KEY sk_test_composition_fixture --env-file /absolute/private/local.env
node node_modules/convex/bin/main.js run --component betterStripe core/queries:getStripeMode '{}' --env-file /absolute/private/local.env
```

Choose unused ports. Do not weaken a schema, clear unrelated data, or reuse a
shared deployment to make an installation check pass. The original local spike
installed `betterStripe`, `betterStripe/workflow`,
`betterStripe/workflow/workpool` and
`betterStripe/workflow/workpool/batchWorker`, then returned `"test"` for mode.

Generate references with `pnpm run codegen` against that local deployment. Do
not edit generated files by hand. Run `pnpm run check:all` before handoff.

The original local push proved nested installation and generated references;
the runtime harness proved persisted test-state execution. Later domain and
cross-domain checks added local-backend restart and reconciliation evidence.
See the [release handoff](../release-handoff.md#verification-and-release) for
those scopes. Synthetic provider transports and dummy keys do not establish live
Stripe eligibility or actual money movement. Live provider reconciliation and
production rollout require separately authorized acceptance. None of these
checks establishes exactly-once external effects or automatically completes a
financial migration.
