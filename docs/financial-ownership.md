# Financial bucket ownership provenance

`betterStripe.financialOwnership` records immutable host ownership of a financial bucket. It supports physical Stripe account keys and opaque logical keys, including affiliate earnings that have no provider account yet. This is provenance, not a second money ledger. Registration does not rewrite source keys, amounts, balances, transfers or payout history.

All registration, lookup and discovery responses report `coverage: "unknown"`. Exhausting discovery means only that the registered ownership rows for that exact scope were enumerated. It does not establish complete financial history, absence of outstanding work, current provider usability or permission to close an account. No API accepts a `complete` flag. Source observations, legacy backfill, financial attempt admission and host business-policy guards require separate accepted integrations.

## Trusted host boundary

Call this API only from an authorized server adapter. Authenticate the current host actor and derive its allowed owner scope before supplying `userId` and optional `orgId`. Neither a bucket key, cursor nor a claimed user identifier is authorization. Component lookup intentionally returns provenance for a trusted host; do not expose it as an unrestricted browser query.

For a new physical registration, the component verifies exact current reciprocal mapping through the unique personal resolver or bounded organization-scope proof. A historical registration requires one exact closed-account owner record. Duplicate mappings, duplicate closure records, foreign ownership, unresolved closure, ownerless history and malformed provider keys refuse registration. Pending capability/KYC is unrelated to ownership and is not interpreted as readiness.

Logical ownership is a host-domain fact. Before registering it, the host must verify the actual immutable source record and its owner, then supply its stable integration and record identity. Arbitrary key spelling such as `user:123` or `acct_example` never implies ownership. A proof reference records the host's verified source; it alone does not establish coverage. Unverified legacy keys remain unknown. An absent host migration/integration cannot be replaced with a guessed alias list or account timestamp.

```ts
// Server only, after current-actor authorization and actual source-owner verification.
await betterStripe.financialOwnership.register(ctx, {
  bucketKey: source.financialBucketKey,
  kind: "logical",
  userId: source.verifiedOwnerUserId,
  source: {
    integration: "host-affiliate-registration-v1",
    recordId: source.id,
  },
});

// Server-derived personal account selector; physical proof is component-owned.
await betterStripe.financialOwnership.register(ctx, {
  bucketKey: verifiedAccountId,
  kind: "stripe_account",
  userId: authenticatedOwnerId,
});
```

## Immutable receipts and bounded discovery

Exact-key lookup returns `status: "unknown"` for an unregistered bucket or `status: "registered"` with its immutable registration. Matching registration retries reuse the same receipt. Changing its owner, kind or logical source identity rejects atomically. A previously verified physical receipt survives closure and active mapping removal; replay returns original ownership provenance, not a fresh current-account or readiness assertion.

Owner scope is the exact `userId` and optional `orgId` tuple. Organization-owned registrations never appear in a personal discovery query, even when they retain the same user identifier. Hosts must authorize both selectors and retain historical organization context rather than inheriting it into personal ownership.

```ts
const page = await betterStripe.financialOwnership.discover(ctx, {
  userId: authenticatedOwnerId,
  paginationOpts: { numItems: 25, cursor: previousCursor },
});
```

Pages use the component-compatible indexed paginator, at most 100 requested rows with fixed 200-row/1 MB read bounds. Preserve `continueCursor`, `isDone`, optional split metadata and native pagination identity. A full last page can require an empty continuation before `isDone` becomes true. Keep cursors scoped to the authorized owner query; a cursor is not an immutable snapshot.

The returned generation advances only when a new bucket is registered in that owner scope. Matching replay does not advance it. It is a registration provenance generation, not a financial revision. This slice has no financial writer observers, so a newly written or unmapped money record does not automatically invalidate a completeness claim here. No completeness claim is available at all.

## Verification boundary

Real-schema tests exercise current and closed ownership, explicit logical provenance, ambiguity/refusal, replay/conflict, organization isolation, pagination beyond 100 rows and unchanged financial records. Public SDK tests dispatch through the actual component without a Stripe secret. Native verification must use an isolated component runtime. These tests establish registration/discovery behavior only; they perform no provider closure, bank payout, settlement or live financial acceptance.
