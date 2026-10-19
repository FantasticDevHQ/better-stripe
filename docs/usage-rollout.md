# Adopt, roll out and roll back usage billing

Metered billing is opt-in. Installing a package does not convert existing fixed
subscriptions, import historical usage, mint credits or authorize new billing.
Keep the original component instance name and all existing financial records.
Start with [setup](metering-setup.md) and the [model recipes](metered-usage.md).
This guide describes a controlled host cutover, not an automatic migration.

## Inventory original ownership and obligations

Record the original issuer realm, mode, Accounts v2 payer/mapped Customer,
subscription/item/price IDs, meter/event name, plan/version, currency, period,
source-event namespace and provider/API/worker versions. Keep a mapping from each
business activity to its original immutable binding. Inventory outstanding sends,
reservations, correction attempts, invoice adjustments, payments, grants, refunds,
disputes, transfer/recovery operations and affiliate policy.

Read bounded pages to completion; truncated or legacy-unknown coverage is not an
empty history. Compare local effective usage, accepted delivery, native aggregates
and original finalized invoices separately. Preserve all unknowns and original
occurrence times. Confirm host authentication and server-owned authorization
before exposing any new catalog, activity, billing reader or action.

## Add usage to fixed-price billing

Choose whether the existing fixed subscription remains an intentional base fee
or is replaced at an authorized future boundary. A new usage-only enrollment can
use `fixedPriceIds: []`; a new mixed enrollment can include the chosen monthly
fixed price. Do not charge a duplicate fixed base accidentally while the original
subscription remains active. Existing fixed-price APIs and original invoices keep
their behavior and provenance.

Select a model, immutable unit/rate/version, authorized future start/period and
stable signup ID. Provision the native catalog and managed subscription only for
the intended new work. Observe its native accepting status and period, configure
allowance or verify a paid prepaid grant, then admit activity. A successful setup
screen or Checkout redirect is not proof of payment or entitlement.

## Existing usage systems and catalog adoption

There is no general public importer for an arbitrary existing subscription,
provider event, historical invoice, payment or credit balance. `adoptUsageMeter`
verifies an exact native catalog resource; it does not adopt past financial
activity or release another enrollment's locks. Follow [catalog adoption](usage-catalog.md)
for its exact identity requirements. Preserve original prices and their immutable
terms for every previously accepted activity.

For a new managed enrollment, first stop the old writer at an explicit boundary,
drain/reconcile its original work and close its native billing obligations. Keep
the old subscription/item/price IDs in history. Retire a managed enrollment only
with its complete original final invoice proof. Native overlapping customer/meter
subscriptions block new enrollment; do not bypass that guard with a payer alias,
second component instance or changed event ID. Independent Dashboard/API writers
must also be controlled by the host.

An unbilled, provably unsent activity may be admitted only under its authorized
original identity, native binding and valid original period/time window. Do not
backfill already billed, delivered or ambiguous historical activity through
`record`. Older or unprovable history needs a separately reviewed import or native
adjustment procedure. Do not make it eligible by replacing occurrence time,
creating another source ID or reclassifying it as new work.

## Change a billing model or price

Use a future billing boundary and a new immutable version/event name/price lookup
key for changed terms. Never rewrite the original plan, price, subscription
snapshot, quantity or payer of an accepted event. Keep old readers and workers
available until the old scope is fully reconciled and retired. The new model only
admits genuinely new business activity.

Included quantities reset in a separately verified active monthly period; old
consumption and reservations remain auditable. Native test-clock renewal ahead
of the real server is read-only, with `not_active_yet` allowance rather than an
invented reset. A hard cap is enforced by reservations, not an aggregate preview.

Paid prepaid grants remain attached to their original issuer, price, purchase and
terms. A new model, price or UI balance does not move or convert those credits.
Resolve unspent/consumed backing, refunds, disputes and affiliate recovery through
the original purchase contracts. Do not treat consumption as another sale, create
an offsetting fake grant, or pay a seller from credit redemption. See
[credits](usage-credits.md), [corrections](usage-corrections.md) and
[original-source settlement](usage-settlement.md).

## Rollout and drain

1. Exercise the three-model sandbox paths and the packed/native verification
   matrix with the intended account configuration. Record unsupported modes.
2. Keep new billing admissions off while validating authenticated adapters,
   persisted business completion markers, internal delivery handles and callback
   authorization. Shadow observations must not send a second copy of real usage.
3. Enable a bounded opt-in cohort and record its original binding/version. Observe
   queue state, native lag, exact quantities, credit backing and invoice outcomes.
4. Before closing or replacing a scope, fence new work and new purchase/correction
   intents. Drain queued work with its original IDs; reconcile every unknown or
   pending provider effect instead of blindly resending it.
5. Require complete native/local equality, resolved corrections and purchases,
   zero outstanding reservations, and fresh original financial evidence. Then
   complete cancellation/final invoicing and supported retirement/credit closure.
6. Preserve payer, original resources, ledger, delivery/history, payments, grant
   backing and recovery liabilities. Deactivate only owned resources whose
   obligations are resolved. Cleanup is not deletion or debt forgiveness.

Bounded readers, retained-event and audit quotas deliberately stop rather than
silently truncate. Plan retention/export before hitting those bounds. No quota
reset, financial-history deletion or automated production backfill is provided.

## Rollback

Disable new admissions to the affected cohort. Keep the original deployment
handlers, internal action handles, API/definition versions and component instance
available for existing workers and callbacks. Finish or explicitly hold original
operations; inspect their retained status before retrying. A credential outage
cannot turn an uncertain send into an unsent event.

Do not restore an old database snapshot over newer payments, grants, usage,
transfers or revision authority. Do not deploy a legacy-only writer that cannot
interpret retained operations. Preserve any separately activated payout revision
journal according to [its migration contract](payout-revision-migration.md).
Code rollback does not cancel invoices, restore credits, reverse transfers or
refund a customer. Use the original financial recovery APIs and verify outcomes.

After reconciliation, a new explicit enrollment/version can resume future work.
Do not replay the old cohort into another scope to repair the rollout.

## Release handoff

Use the existing automated Release Please/changelog workflow. Preserve generated
release descriptions and standalone notes delimiters; put current review evidence
in comments. Follow [release policy](releasing.md) and
[component handoff](release-handoff.md). Do not hand edit a version or changelog to
claim publication. A workflow with publication skipped is not a published package.

Before handoff, build and pack the reviewed candidate, compile/load public root,
`/usage`, `/react` and `/testing` exports, and validate the `/convex.config` wiring
through the supported Convex bundler/codegen. The config's upstream runtime is not
a standalone Node ESM smoke-test target. Check that every linked Markdown guide
is in the actual tarball. Run the unchanged `pnpm run check:all` and current-head
CI, with independent acceptance and sanitized evidence directly in the PR.

The [verification matrix](usage-verification.md) contains native six-fixture proof,
actual invoice/fee/transfer economics, deterministic SDK failures, packed
consumers and explicit account/clock/throughput limits. The
[example walkthrough](usage-example.md) is the developer exercise. This handoff
covers reviewed source and a packed candidate. It does not authorize npm
publication, merging a release PR, production deployment/migration or live billing.

The [packed component handoff evidence](https://github.com/FantasticDevHQ/better-stripe/tree/main/docs/evidence/usage-handoff) records the extracted-candidate native bundler/codegen check and its reproduction command.
