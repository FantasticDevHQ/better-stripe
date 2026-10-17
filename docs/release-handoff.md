# Component migration and release handoff

This guide covers the component extraction and its verified cross-domain boundaries.
It describes the reviewed source surface, not a claim that a particular npm
version has been published. Select the actual reviewed release candidate and
verify its public artifact before installing it in an application. Existing
public methods remain available; adopting a durable workflow is an explicit
host cutover, not an automatic migration on deployment.

## Installation and nested runtime

Use Node.js 20 or newer and Convex `^1.46.0`. The example development toolchain
has its own newer Node requirement. BetterStripe pins Workflow `0.4.10` and
Workpool `0.4.14`; Workflow installs its nested Workpool and Batch Worker.
Install BetterStripe once under the existing component instance name:

```ts
// convex/convex.config.ts
import betterStripe from "@fantastic.dev/better-stripe/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({ env: { STRIPE_SECRET_KEY: v.string() } });
app.use(betterStripe, {
  env: { STRIPE_SECRET_KEY: app.env.STRIPE_SECRET_KEY },
});
export default app;
```

Keep the original instance name when upgrading so stored data remains attached.
Regenerate app/component bindings using supported Convex codegen in the
selected development deployment, then validate the application before rollout.
Do not edit generated references. The native tree is
`betterStripe/workflow/workpool/batchWorker`; hosts do not install a sibling
Workpool or enqueue Workflow steps again. The shared manager limits concurrent
steps to two and disables automatic action retries.

Component configuration is consumed by Convex's bundler. Its upstream Batch
Worker dependency has an extensionless import that is not a supported standalone
Node ESM entry point. Verify config types and Convex bundling separately from
ordinary root, React and testing runtime imports. Do not use a raw Node import
of the config as the installation test.

## Public surface and ownership

The root, `react`, `testing`, `convex.config`/`convex.config.js` and
`_generated/component`/`_generated/component.js` package paths are preserved.
Domain types are exported from the root. Schema tables, functions and nested
runtime references are registered by the component; host applications keep
business data and authenticated authorization adapters.

| Area                                                    | Public entry point                                                                                                        | Host responsibility                                                                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Catalog                                                 | `adoptProduct`, `getStripePriceByLookupKey`, `ensurePrice`                                                                | Product ownership, allowed tiers, immutable price version policy and caller idempotency namespace                                    |
| Portal and accounts                                     | Portal configuration/session methods and account configuration helpers                                                    | Authorize the account; select provider configuration, allowed products and redirect policy                                           |
| Payment provenance                                      | `getVerifiedPaymentSource`                                                                                                | Authorize scope and select the intended original payment, never infer ownership from metadata alone                                  |
| Recovery preparation                                    | `costRecovery.prepareGroup`                                                                                               | Choose same-currency scope, source and maximum debit/credit; repeat bounded preparation until done                                   |
| [Recovery execution](architecture/recovery-workflow.md) | `costRecovery.startGroup`, `getGroupOperation`, `resumeGroup`, `requestGroupCancel`                                       | Authorize immutable allocation, provider action, completion projection and release policy                                            |
| [Processing costs](processing-cost-reconciliation.md)   | `costRecovery.startProcessingCostReconciliation`, `getProcessingCostReconciliation`, `resumeProcessingCostReconciliation` | Choose deficit policy, pin independent main/rollback revisions, provide verified legacy import and database projection hooks         |
| [Balance funding](balance-funding-workflow.md)          | `balanceFundingWorkflow.prepare`, `apply`, `inspect`, `resume`, `cancel`                                                  | Authorize account/subscription, record consent, select the explicit preview configuration and preserve original restoration settings |

`prepareBalanceFunding`, `setBalanceFunding`, reserve/seal/finish, invoice
attachment/reconciliation, existing readers and settlement APIs remain available.
Do not run independent old and new executors for the same financial identity.
The [design record](architecture/component-extraction.md) explains the ownership
split; its historical proposal signatures are not the current export inventory.

## Provider boundary and configuration defaults

The ordinary Stripe client defaults to `2026-09-30.endive`. Balance funding
requires explicit `stripeApiVersion: STRIPE_CUSTOMER_PREVIEW_API_VERSION`, which
selects `2026-09-30.preview`; this is not enabled by default. Actual Stripe
account/preview eligibility must be verified separately. Pin provider/API and
definition versions on every operation. Keep compatible old host actions and
workflow definitions available while their operations may resume.

A host internal action accepts only a scoped operation reference and versions.
It reads credentials at execution time. For example, this processing-cost
adapter delegates provider verification to the package:

```ts
// convex/billing/actions.ts
import { BetterStripe } from "@fantastic.dev/better-stripe";
import { v } from "convex/values";
import { components } from "../_generated/api";
import { internalAction, env } from "../_generated/server";

export const observeCost = internalAction({
  args: {
    accountId: v.string(),
    scopeKey: v.string(),
    currency: v.string(),
    operationId: v.string(),
    version: v.number(),
    providerApiVersion: v.string(),
    definitionVersion: v.number(),
  },
  returns: v.any(),
  handler: (ctx, args) => {
    const stripe = new BetterStripe(components.betterStripe);
    return stripe.costRecovery.observeProcessingCosts(ctx, args, {
      stripeSecretKey: env.STRIPE_SECRET_KEY,
    });
  },
});
```

An authorized host mutation passes `internal.billing.actions.observeCost` as the
provider reference when starting reconciliation. The package converts the
reference to a serializable function handle. Never put credentials, raw provider
responses, exception messages, consent restoration settings or host metadata in
workflow arguments, journals or completion context. The provider bridge validates
closed receipts and sanitizes exceptions before journaling. The action above
is a read-only provider adapter; it is not a browser-authorized endpoint.

Recovery and processing-cost workflows default to three readiness observations
with a 1,000ms delay. Recovery requires an explicit immutable `releaseUncollectible` policy; enabling it authorizes release on an uncollectible invoice, so choose it in the host and never infer it from cancellation. Configured attempts are bounded to 1–20 and delay to
1–86,400,000ms. Only known retryable `not_ready` observations retry. The exported
`financialRetryDecision` is a pure decision helper and schedules nothing;
its `maxRetries` counts additional attempts. Conflicts, rejection and unknown
effects never authorize blind replay. Domain SDK write phases disable automatic
Stripe network retries as well as Workflow action retries.

## Status, resume, cancellation and retention

Processing-cost reconciliation exposes status and resume, with no generic cancellation API. Pause new host admissions when stopping those observations. Funding and recovery have their own explicit cancellation methods.

Operation status is scoped by the saved account, opaque scope, operation ID and
version; funding also binds the original subscription. Authorize status and
control calls in the host. Polling status does not itself perform provider work.

- `not_ready` means a known readiness condition can receive the bounded retry.
- `conflict` requires an explicit fresh host decision; resume does not silently refresh revisions or change identity.
- `unknown` holds uncertain effects and reservations. Reconciliation can use known IDs and positive receipts; absent or unchanged provider state does not prove no write happened.
- A saved verified receipt takes priority over provider re-observation when finishing a failed database step. Resume preserves original operation keys and versions.
- Cancellation stops future dispatch where possible and cannot abort a provider call already in flight. It is neither a refund nor proof that funds were released. Recovery cancellation before dispatch keeps sealed reservations held; its completion projection is success-only.

There is no universal time-based permission to delete financial operation or
receipt evidence. Workflow journal cleanup is separate from financial ledger
retention. Keep definitions, provider handles, phase keys, import checkpoints,
original restoration snapshots and receipts while any operation can resume.
Missing, cleaned or incompatible history stays held for reconciliation; it must
not allocate a fresh provider attempt. Ordinary public domain methods do not
expose a journal cleanup shortcut. See the [runtime retention limits](architecture/durable-execution.md#definition-versions-and-retention-limits)
and the domain guides for the exact continuation paths.

## Cutover and rollback

1. Inventory existing scopes, pending groups, legacy worker keys, original restoration settings, receipts and host projections. Retain original identifiers and namespace new request keys. Verify package/API compatibility in an isolated development deployment.
2. Pause old dispatchers for each identity before enabling the replacement. Drain in-flight workers and obtain positive receipt evidence. Funding's quiescence confirmation is an operator attestation bound to the exact paused snapshot; matching current settings alone is insufficient.
3. Import only verified legacy records with their original provider keys, owner, source economics and revisions. Keep historical source rows. Unknown, ambiguous, incomplete or unmapped records remain held and observable; never invent a collected group, substitute a current price, zero costs or forgive a claim.
4. Enable the new host adapter for verified identities. Replayed callbacks must use operation ID/version and commit database projections atomically with component completion. Keep existing claim/reservation/transfer ledgers as the money authority; host job tables are metadata only.
5. Check bounded status/counts and reconcile held records before retiring compatibility paths. Schedule host reporting and observation jobs explicitly; the component does not inherit a host cron cadence.

To roll back a rollout, pause new admissions and dispatchers, preserve journals
and receipts, and reconcile all in-flight or unknown operations using their
original keys and definitions. Reverting application code is not a financial
rollback. Do not reactivate an old executor for an imported identity or delete
new tables, checkpoints or restoration data. If the older release cannot read
new operation state, keep the compatible executor deployed for reconciliation
and perform an explicitly authorized per-identity repair. A failed or canceled
workflow alone cannot justify releasing reservations or replaying a write.

The [funding cutover runbook](example-balance-funding-cutover.md) documents
paused imports, quiescence, bounded backfill and restoration. The
[recovery cutover runbook](example-recovery-cutover.md) covers exact legacy
mirrors, partial finish-only continuation, blocked counts, affiliate offsets,
refund races and held cancellation. These example functions use demo personas;
production hosts must derive authorization from authenticated sessions.

## Verification and release

Run `pnpm run check:all` without lowering floors or raising budgets. Build and
pack the candidate, inspect its file inventory, install that actual tarball in
a clean consumer, typecheck with `skipLibCheck: false`, and test root/React/testing
runtime imports plus native Convex config bundling and generated component
references. The packed-doc regression follows local Markdown links from the
README and migration guide against the actual tarball, not a workspace symlink.
A local pack is consumer proof, not npm publication.

The merged cross-domain suite under `src/component/durableExecution/` and the
example domain suites cover replay, concurrency, independent revisions,
callback atomicity, provider success before persistence failure, restart,
legacy adoption and held unknown/cancel boundaries. Tests and native checks use
synthetic transports or dummy keys. They do not establish live Stripe preview
eligibility, exactly-once external effects or production migration completion.
Keep sanitized test, consumer and native evidence directly in the integration PR.

Follow [the release process](releasing.md). Use a Conventional Commit PR title;
Release Please owns package version, manifest, README version line and changelog.
Do not hand-bump them for this handoff. Preserve its generated release description
and standalone notes delimiters; put review evidence in comments. Recheck the
actual release candidate and required CI before any merge. After separately
authorized publication, verify the npm version, integrity/provenance and public
artifact. A successful workflow with Publish skipped is not publication. This
handoff does not publish npm, create a tag, deploy production or run a live backfill.
