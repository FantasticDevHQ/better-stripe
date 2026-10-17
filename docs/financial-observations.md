# Settlement source observations

`betterStripe.financialObservations` exposes trusted host diagnostics for original settlement allocation sources and destinations. It records references and fingerprints, not a second financial ledger. Every response reports `coverage: "unknown"`; a registered owner, indexed destination or exhausted page never proves the absence of outstanding work or authorizes account closure.

## Observed producer and bounds

The version 1 producer is the actual raw-context `reserveSettlementAllocation` mutation. Its transaction records the original allocation ID, charge identity, immutable source fingerprint and diagnostic generation. Matching reservation replay observes the original persisted allocation, preserving existing financial behavior when caller amounts differ. No source row, amount, balance, claim or provider request is rewritten by observation.

At most **100 destination legs** are indexed synchronously. Within that bound, each leg retains its original allocation ID, leg index, destination key and role. An allocation with more than 100 legs remains financially valid and records a durable `isOverflow: true` source marker with UNKNOWN coverage and no synchronous destination rows. The marker retains the original allocation reference and total leg count. The trusted host can explicitly resume oversized traversal in bounded transactions. No capped list is described as complete. An allocation with no legs records an empty source marker without inventing a recipient.

Existing allocations have no automatic legacy backfill. A missing source observation remains unknown until an actual reservation replay observes it. Transfer fact writers, claimed reversal slices, affiliate/seller-cost/payout producers, legacy backfill, attempt admission and whole-V2 host purchase/configuration/consent guards require separate accepted integrations. This feature does not make account closure safe or activate a close control.

## Ownership and late facts

Leg ownership comes only from the exact immutable financial ownership registry binding. No user is inferred from destination spelling, provider mapping, account creation time or a caller-supplied alias. An unregistered bucket is indexed with `ownershipStatus: "unknown"`, without an owner. For synchronous allocations, a later legitimate first registration becomes visible when the actual source writer replays. Pending oversized continuation can observe it when validation reaches that slot. A completed traversal remains historical; none of these observations certifies complete coverage.

Once observed, a registered leg keeps its original owner pin through registry absence, ambiguity or contradictory replacement. Historical destination rows never redirect to a replacement owner. Missing registration yields unknown ownership, duplicate registration yields ambiguous ownership, and changed ownership yields contradictory ownership. Source identity conflicts, duplicate charge sources and changed original financial source content retain an explicit contradictory source marker. Missing previously indexed slots, duplicate slots and malformed observation slots are held before selecting any leg: index, original destination, role and source-charge identity must agree. Ambiguous observation rows are retained unchanged, with a contradictory source marker rather than a silent repair. Contradictions are held rather than repaired by rewriting financial facts.

Source generations advance when source or ownership observations change. Matching replay remains stable, including repeated contradictory facts. Exact-bucket and owner diagnostic generations advance for affected indexed scopes; they are diagnostic invalidation tokens, not certified financial coverage. A missing scope starts at generation zero; an ambiguous or invalid generation is returned as null. Overflow destinations that have not been indexed cannot be discovered through those scope indexes, which is why UNKNOWN must be preserved until and after those destinations are indexed.

## Server integration

Authenticate the current host actor and derive the allowed owner/bucket scope before calling these readers. They are trusted component/server APIs: a bucket key, allocation ID, user identifier or cursor is not end-user authorization. Keep organization scope explicit rather than inheriting organization history into personal queries.

```ts
const diagnostic = await betterStripe.financialObservations.source(ctx, {
  allocationId: originalAllocationId,
});
const destinations = await betterStripe.financialObservations.bucket(ctx, {
  bucketKey: authorizedBucketKey,
  paginationOpts: { numItems: 25, cursor: previousCursor },
});
const ownerSources = await betterStripe.financialObservations.owner(ctx, {
  userId: authenticatedOwnerId,
  paginationOpts: { numItems: 25, cursor: previousCursor },
});
```

Bucket/owner readers use exact indexed pagination, request sizes 1–100, fixed 200-row/1 MB read bounds and native continuation/split metadata. Preserve `continueCursor`, `isDone` and native pagination identity. A full final page may require an empty continuation. Cursors are scoped to the authorized query and do not establish an immutable snapshot. All pages, including empty/exhausted pages, remain UNKNOWN; there is no caller complete flag or closure-readiness API.

## Explicit oversized continuation

After observing an oversized allocation, call `financialObservations.resume` with its current diagnostic generation. Each transaction indexes at most 100 original destination slots, then advances a durable cursor atomically with those rows. Once every original slot is indexed, subsequent calls advance validation by at most 100 stored slots per transaction, with one indexed lookahead row. Only an actual end-of-source validation marks `continuation.state` as `"complete"`. `isOverflow` remains true because the original allocation exceeded the synchronous bound.

```ts
const result = await betterStripe.financialObservations.resume(ctx, {
  allocationId: authorizedOriginalAllocationId,
  expectedGeneration: diagnostic.observation.generation,
});
```

The host must authorize the allocation and explicitly drain both phases, persisting or rereading the returned generation between calls. There is no implicit scheduler, automatic legacy discovery or fixed lifetime batch limit. A lost acknowledgement can replay the same generation safely: it returns the current diagnostic without advancing another batch. A transaction failure commits neither destination rows nor cursor progress. The source reader supplies durable progress after a host restart.

A missing or duplicate marker returns a null UNKNOWN observation. Changed original financial content, ambiguous charge identity and structurally inconsistent cursors hold the traversal with `isContradictory: true`. The validation pass holds when its current indexed page contains missing, duplicate or malformed slots. Existing ambiguous rows are preserved; continuation never repairs them by recreating an owner pin. Previously observed owners remain pinned through registry absence or replacement. Validation can update their diagnostic ownership status without redirecting historical rows.

The integrity boundary is the package-owned writers. They append destination slots and patch diagnostic ownership, advancing the source generation in the same transaction. They never selectively delete slots or change a committed slot's identity. Validation advances over that stable prefix in separate transactions. A privileged database edit that deletes an already validated prefix or forges an otherwise consistent completed marker bypasses this writer/generation contract; this API does not certify arbitrary database-tamper integrity or rescan the entire prefix on every call.

Completion describes a historical validated traversal of this one original allocation, not a fresh ownership snapshot. A first ownership registration arriving after its slot was validated, or after completion, does not automatically rewrite that historical observation. Neither completion nor its ownership statuses certify current ownership or current liabilities. It does not prove complete financial ownership, absence of liabilities, complete producer coverage or completed legacy backfill. The host must stop on held/null results and handle recovery explicitly. Every response, including a completed traversal, still reports `coverage: "unknown"`. Source allocations, destination amounts and provider operations remain untouched.

## Verification boundary

Real-schema tests exercise raw-context reservation, persisted-original replay, late observations, source/owner contradictions, organization isolation, more than one page, empty allocations and allocations over the synchronous bound. Public SDK tests dispatch into the actual component without Stripe credentials. Native evidence uses an isolated local component. These tests perform no provider financial operations, closure, payout, settlement transfer or admission fencing.

## Transfer facts and deferred batches

`stripe.financialObservations.transfer(ctx, { transferId })` reads one exact
component transfer document reference. `transferBucket` and `transferOwner`
paginate the original destination and trusted registered owner. Personal and
organization scopes stay separate. `transferBatches` paginates one exact
operation identifier. All four readers always return `coverage: "unknown"`.
The host must authorize each selector before exposing these server APIs.

The package records transfer observations atomically with Connect upserts,
confirmed reversal receipts, affiliate recovery/restoration, claim-frontier
updates and releases. Derived earnings backfill also observes its stored fact.
Original transfer, source, destination and first registered owner references stay
pinned. Matching observations replay without advancing their generation; later
financial facts advance it. Missing or ambiguous ownership stays unknown.
Contradictory original identity remains diagnostic and never repairs a monetary
row. Only the derived `totalsRecorded` flag is excluded from the financial
fingerprint. Metadata and other persisted financial fields are included.

Claim and release batches synchronously observe at most 100 affected transfers.
Larger financial operations still process their complete existing slices. In the
same transaction they retain a pending batch with the original operation document
reference, source charge, producer/version, fingerprint/generation and every
compact original transfer document reference. The two producer kinds are
`transfer_frontier_claim` and `transfer_frontier_release`. A release can delete its
original operation while its reference and deferred transfer references survive.
These records contain provenance, not another monetary ledger. Trusted hosts
explicitly drain them through the bounded continuation API below.

Every transfer reader includes `producerGeneration` and `hasDeferredWork`.
Pending batches invalidate any inference that an older owner or destination page
reflects the latest batch. Exhausting a page does not clear pending work or prove
complete financial history. Missing legacy observations and producer versions
remain unknown. A completed historical observation never certifies current
ownership, current liabilities or account-closure eligibility. Initial ownership
registration after an observation does not automatically refresh it.

Native checks preserve the previously supported 1,000-transfer claim across four
shared destination buckets, with registered personal/organization and unknown
ownership, and the 100-transfer synchronous boundary. Historical public claims
with 1,001 transfers can still be released without per-row observation work.
The accepted baseline separately exceeds native read limits for a claim with
1,000 distinct destinations because of existing earnings-summary work; this
observation contract does not fix or claim support for that shape.

Observations rely on package-owned append/patch writers and their transactional
generation changes. They do not certify arbitrary privileged database edits,
selective deletion of historical observations or forged diagnostic markers.
No provider operation, financial-attempt admission or positive closure clearance
is part of this contract.

## Resume every retained transfer reference

Use `stripe.financialObservations.transferBatch(ctx, { batchId })` to read an
exact marker, then call `resumeTransferBatch(ctx, { batchId, expectedGeneration })`
with its returned generation. One transaction indexes at most 50 original
transfer document references or validates at most 50 committed reference receipts.
Repeat until the marker reports historical completion or a held cursor. Callers
never supply cursor state or a complete flag. A stale acknowledgement returns the
current marker without advancing twice. There is no fixed lifetime reference cap.
The original financial operation and every retained reference stay intact.

`transferReferences(ctx, { batchId, paginationOpts })` exposes compact provenance
receipts through exact indexed pagination, up to 100 rows per page. Preserve native
cursor, split and page-status metadata. Receipts hold original transfer and
observation references, position, generation and fingerprints. They contain no
duplicated amounts. A successful final pass checks every retained slot and its
actual source/observation before the marker leaves pending state. Missing or
duplicate sources, ambiguous provenance, contradictory identities, cursor drift
and supersession hold the marker with UNKNOWN coverage rather than recreate or
repin history. Both claim and release markers use this same protocol, including
releases whose original operation document was deleted.

Each active cursor binds immutable marker source/version/fingerprint and the
global transfer-producer generation. Its own indexing writes and checkpoint
commit atomically. A financial write between commits holds the cursor without
resetting or silently accepting a previously validated prefix. This conservative
global fence can also hold traversal after an unrelated transfer changes; it is
not an availability guarantee under continuous writes. Held references remain
pending, with no automatic restart or closure permission.

Existing registered owner pins and explicitly unregistered ownership snapshots
survive traversal. A late first registration does not repin an already unknown
observation. A legacy transfer's first observation may bind its current trusted
registration, but that is not proof of who historically owned the original sale.
Completed traversals remain historical after later financial or ownership facts.
They never certify fresh ownership, current liabilities, complete financial
coverage or safe account closure. Aggregate coverage always remains UNKNOWN.

The final pass relies on supported package-owned append/patch writers and atomic
generation invalidation. It does not certify arbitrary privileged marker forgery
or deletion of an already validated prefix. The native capacity proof drains every
reference from an actual old-public 1,001-transfer claim/release and a current
1,000-transfer mixed-owner claim across separate committed calls, while retaining
all financial rows and amounts. No provider operation or financial-attempt
admission is part of this continuation API.

## Lossless operation evidence maintenance

`stripe.operationEvidence` is explicit trusted-host maintenance for actual
persisted reversal-operation documents. Authenticate the host actor and derive
the authorized source document before calling it. A source ID, selector, digest
or cursor is not end-user authorization. The host selects an existing document;
it cannot supply invented financial bytes.

```ts
const observed = await stripe.operationEvidence.capture(ctx, {
  sourceId: authorizedPersistedOperation._id,
});
const page = await stripe.operationEvidence.headers(ctx, {
  paginationOpts: { numItems: 25, cursor: previousCursor },
});
if (observed.header) {
  const original = await stripe.operationEvidence.original(ctx, {
    headerId: observed.header._id,
  });
  const latestObserved = await stripe.operationEvidence.latest(ctx, {
    headerId: observed.header._id,
  });
}
```

Original means the first trusted observation, not provider creation or
historical owner proof. Separate headerless documents retain the exact admitted
source fields for original and latest observed data. Compact headers retain the
original source reference, first-observed provenance, fingerprints and
generation. Payload documents add no annotation or duplicated exposure envelope:
a legal source can already be exactly the native 1 MiB document limit. Canonical
Convex encoding preserves special floats, optional presence and array order
while normalizing recursive object-key order.

Stable maintenance replay changes no evidence generation. Changed source data
updates the latest observed payload and global operation generation atomically;
original data and identity never redirect. Contradictory original identity stays
explicit, with actual latest bytes retained. Deletion after observation does not
erase the retained payloads. A source missing before observation creates no
evidence. Missing or damaged evidence is not silently recreated.

Header pages contain compact references only, up to 100 per request with fixed
read bounds. They never fan out to payloads. Original and latest hydration are
separate one-payload reads. `resolve(ctx, { selector, value })` accepts either
`operationId` or `sourceChargeId`, without narrowing admitted financial strings.
It reads at most two compact digest candidates and hydrates only one unique
original payload to verify raw selector equality. Missing, reused, colliding or
otherwise ambiguous selectors return a null header and UNKNOWN. A source charge
with multiple observed operations is ambiguous for this unique resolver; it is
not an exact-scope page. There is no full-payload fallback scan or repin.

Every response reports `coverage: "unknown"` and the current maintenance
`evidenceGeneration`. This is the current maintenance-evidence generation only.
Latest means latest **observed** data. Financial claim,
release and exposure writers do not invoke this maintenance automatically.
Changes that have not been explicitly captured therefore need not change its
generation. No drained-page or source-generation token certifies complete
history, current financial state, liabilities, ownership or closure readiness.

Maintenance is atomic and can abort at native aggregate read/write or rate
limits. It does not change financial source rows, swallow a resource abort as
success, or promise unlimited backlog capacity. Per-document lossless storage
does not prove that adding future hooks preserves aggregate financial
transaction capacity. That requires separate baseline-versus-hook measurement
before lifecycle integration. No financial writer hooks, destination/owner slice
index, provider operations, admission fence or automatic backfill is included.
Lifecycle/frontier integrations need separate raw-writer hooks and both financial
fact and evidence invalidators before claiming destination or owner coverage.

## Same-bucket earnings summary updates

When a transfer stays in the same destination and currency, its derived earnings
update reads the unique summary once. It still validates subtraction, zero-count
reset/reapplication and safe integer/net arithmetic before deciding whether to
persist the result. Only an exactly unchanged existing nonzero summary can avoid
a final patch; zero-count deletion and malformed-summary errors remain required.
Moved buckets, unrecorded transfers, payout summaries and financial/risk callbacks
retain their existing behavior.

This is a private derived-summary optimization. Accepted and earnings-only
candidates still exceed the native read limit for 1,000 distinct destinations.
It does not lower the admitted financial maximum, establish complete observation
coverage or prove aggregate financial-hook capacity. Distinct-destination source
read reuse and complete capacity verification remain separate work.
