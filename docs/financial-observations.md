# Settlement source observations

`betterStripe.financialObservations` exposes trusted host diagnostics for original settlement allocation sources and destinations. It records references and fingerprints, not a second financial ledger. Every response reports `coverage: "unknown"`; a registered owner, indexed destination or exhausted page never proves the absence of outstanding work or authorizes account closure.

## Observed producer and bounds

The version 1 producer is the actual raw-context `reserveSettlementAllocation` mutation. Its transaction records the original allocation ID, charge identity, immutable source fingerprint and diagnostic generation. Matching reservation replay observes the original persisted allocation, preserving existing financial behavior when caller amounts differ. No source row, amount, balance, claim or provider request is rewritten by observation.

At most **100 destination legs** are indexed synchronously. Within that bound, each leg retains its original allocation ID, leg index, destination key and role. An allocation with more than 100 legs remains financially valid and records a durable `isOverflow: true` source marker with UNKNOWN coverage and no synchronous destination rows. The marker retains the original allocation reference and total leg count. Oversized ALL-leg traversal is explicitly pending the pending bounded resumable continuation integration; no capped list is described as complete. An allocation with no legs records an empty source marker without inventing a recipient.

Existing allocations have no automatic legacy backfill. A missing source observation remains unknown until an actual reservation replay observes it. Transfer fact writers, claimed reversal slices, affiliate/seller-cost/payout producers, legacy backfill, attempt admission and whole-V2 host purchase/configuration/consent guards require separate accepted integrations. This feature does not make account closure safe or activate a close control.

## Ownership and late facts

Leg ownership comes only from the exact immutable financial ownership registry binding. No user is inferred from destination spelling, provider mapping, account creation time or a caller-supplied alias. An unregistered bucket is indexed with `ownershipStatus: "unknown"`, without an owner. A later legitimate first registration becomes visible when the actual source writer replays; it does not certify complete coverage.

Once observed, a registered leg keeps its original owner pin through registry absence, ambiguity or contradictory replacement. Historical destination rows never redirect to a replacement owner. Missing registration yields unknown ownership, duplicate registration yields ambiguous ownership, and changed ownership yields contradictory ownership. Source identity conflicts, duplicate charge sources and changed original financial source content retain an explicit contradictory source marker. Duplicate or malformed observation slots are held before selecting any leg: index, original destination, role and source-charge identity must agree. Ambiguous observation rows are retained unchanged, with a contradictory source marker rather than a silent repair. Contradictions are held rather than repaired by rewriting financial facts.

Source generations advance when source or ownership observations change. Matching replay remains stable, including repeated contradictory facts. Exact-bucket and owner diagnostic generations advance for affected indexed scopes; they are diagnostic invalidation tokens, not certified financial coverage. A missing scope starts at generation zero; an ambiguous or invalid generation is returned as null. Overflow destinations that have not been indexed cannot be discovered through those scope indexes, which is why UNKNOWN and the pending continuation requirement must be preserved.

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

## Verification boundary

Real-schema tests exercise raw-context reservation, persisted-original replay, late observations, source/owner contradictions, organization isolation, more than one page, empty allocations and allocations over the synchronous bound. Public SDK tests dispatch into the actual component without Stripe credentials. Native evidence uses an isolated local component. These tests perform no provider financial operations, closure, payout, settlement transfer or admission fencing.
