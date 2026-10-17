# Example balance-funding cutover

The cutover moves the example's financial preparation and execution into the installed
BetterStripe component. `storeBalanceRequests` stores host consent intents and
component references, not provider execution history. Queueing and initial
scheduling happen in one mutation. A ten-minute observer watchdog makes abandoned pending intents held and
retryable. Watchdogs are fenced by an observation epoch; an obsolete timeout
cannot hold a newer retry. Same-target retries reschedule even an existing pending
intent and retain its original request and financial operation.
Provider writes and uncertain outcomes belong to the component workflow.

The example still enforces sandbox mode, seller role, current account and plan,
and the subscription's `storeBilling` and `sellerId` metadata. It uses demo
personas. Production hosts must derive the seller from an authenticated session.
No migration action runs automatically on deploy. Starting a payment-source change
migrates that seller's existing legacy record first, if one exists.

## Compatibility and verification

Keep the old `storeBalanceFunding` rows and original host functions throughout
the compatibility window. The importer preserves original method/type restoration
settings, including `null` versus an empty list, consent timestamp, operation
version and provider keys. It pins the legacy `2026-09-30.preview` API version.
It never prepares again from a subscription whose settings have already changed.

Before import, old starts are paused. A late old finish is allowed before the
snapshot is imported; the snapshot hash then changes and must be read again.
After import, old finishes are rejected and must reconcile the component receipt.
Unknown legacy operations have no workflow journal. First stop and drain every legacy worker that could still dispatch its old
provider key, then record an operator audit reference for that exact source
snapshot. Only after this attestation can scoped, verified Stripe readback finish
the operation. Matching target settings alone do not prove an old worker stopped. Missing, mismatched or ambiguous evidence stays held;
it does not start another workflow or provider write.

The action verifies original account, subscription metadata and payment-method
ownership. Import and its checkpoint commit together, with the source hash and
current seller binding checked again. Replacement accounts or subscriptions are
held for explicit review. Original source rows are never deleted by this adapter.

For a pending legacy row, pause and read its `fundingId` and `snapshot` using
`storeBalance/funding/internal/migration:pause`. After independently stopping and
draining old workers, call
`storeBalance/funding/internal/quiescence:confirm` with those values and a bounded
`reference` identifying the operational audit. This is a trusted operator
attestation, not an automated proof. Do not confirm it while an old provider call
could still complete. Re-run the seller migration or backfill after confirmation.
A changed legacy snapshot invalidates the attestation.

## Bounded backfill

Use an isolated sandbox first. Run these internal functions with the intended
example deployment selected. Do not point this runbook at another app's database.
An operator needs the deployment's admin authorization.

```sh
pnpm --filter ./example exec convex run storeBalance/backfill/mutations:start '{}'
# Copy the returned runId into each following command.
pnpm --filter ./example exec convex run storeBalance/backfill/actions:step '{"runId":"..."}'
pnpm --filter ./example exec convex run storeBalance/backfill/queries:state '{"runId":"..."}'
```

Starting a run fences all legacy starts before scanning. Each `step` processes at
most ten rows. The reserved page is persisted before provider reads; interrupted
actions replay it. Acknowledgements use the saved cursor and count each page once.
Counts are derived from current scoped component state. Repeat `step` while the
run is `running`. `verified` means `scanned === active` and `held === 0` at the
checkpoint. It is not proof that live Stripe preview eligibility exists or that
later external changes cannot occur.

A run with unresolved rows finishes as `held`. Reconcile those original records,
then call `start` with `{"rescan":true}` to audit all rows again. Do not delete
source records or disable compatibility readers solely because a scan ended.
Check pending component operations and actual Stripe settings before retirement.
The component remains the sole financial writer after activation; a repeated
scan reads its current verified state rather than restoring the old enabled flag.

## Rollback

Before a global run starts, `funding/internal/migration:rollback` can restore the
legacy writer for one record only if its original source hash, enabled state and
operation version still match, with no active component operation. It pauses
component starts before releasing the old writer. This is a data rollback, not a
Stripe reversal.

After new component operations or a global run, that shortcut is rejected. Pause
starts, reconcile pending provider outcomes and explicitly verify a reverse
mapping before a reviewed deployment rollback. Never recreate old operation
versions or reuse an old provider key for a different effect. Retain component
history and original source records until the compatibility audit is complete.

The sandbox renewal retry reads only verified, enabled component funding with no
active operation and no paused starts. It cannot collect using a stale legacy
payment-method record. An insufficient balance does not authorize card fallback;
that remains an explicit seller recovery choice.
