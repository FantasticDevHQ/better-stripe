# Refund-command evidence

The package provides a bounded component reader for an opaque host refund-command key. It observes synchronized refund records; it does not contact Stripe, prove provider absence, authorize a retry or certify completed money. Public artifact verification and host adoption are separate from source acceptance.

```ts
const evidence = await stripe.getRefundCommandEvidence(ctx, {
  commandKey: originalCommand.providerIdempotencyKey,
  stripeAccountId: originalCommand.originalMerchantAccount,
  stripePaymentIntentId: originalCommand.stripePaymentIntentId,
  stripeChargeId: originalCommand.stripeChargeId,
  currency: originalCommand.currency,
});
```

Authenticate and authorize the host caller before this call. Derive every selector from the original immutable command and verified payment routing. Current community owners or replacement accounts must not remap old payments. The server-only [Vite reference](../example/convex/connect/refundCommandEvidence.ts) verifies a reciprocal unique personal mapping against the original account; demo personas are not authentication. The host still qualifies the original command fingerprint, buyer, invoice allocation, amount/reason, permission and lifecycle.

## Result and bounds

The result is either `observed` with the refund document or `unavailable` with a reason: `missing`, `normalization_incomplete`, `ambiguous`, `correlation_conflict`, `scope_mismatch` or `invalid_receipt`.

The reader first checks one indexed legacy normalization row, then reads at most two rows for the exact global command key and at most two for the candidate provider refund ID. Command-key duplicate detection precedes account/PI/charge/currency qualification; a foreign duplicate cannot be filtered into apparent uniqueness. Duplicated provider refund IDs under different command keys also remain ambiguous. A unique observed row must match the original scope and retain positive safe integer original units and a canonical refund ID. Pending, failed and succeeded states remain distinct. Currency shape validation does not establish supported currency or input precision; the host uses the public currency helpers and original-charge contract.

For a receipt whose persisted `accountId` is absent, the reader additionally reads at most two original payment-intent rows. Exactly one payment must have the same currency and canonical routing: a destination account without split recipients, or an explicit separate charge with exactly one store, canonical unique recipient accounts and no contradictory destination. Multiple payments or stores, affiliate-only routing, missing routing and malformed or duplicate destinations stay unavailable. Legacy destination routing without a charge-type tag remains eligible when no split is present. An explicitly stored refund account is never replaced by this fallback, including an empty or foreign value.

This fallback returns a qualified account only in the observed result; it does not patch the refund or payment, change historical account indexes, select current user/community account mappings or backfill old records. The original PI, charge, currency and command selectors still have to match the receipt. The component payment does not independently certify the provider charge binding: the host must retain its verified original charge and immutable merchant contract. The existing ingestion seller heuristic and bounded 100-row late owner backfill are unchanged. Ownerless history can therefore remain absent from account-filtered history while this exact reader qualifies its synchronized original routing. At most two payment documents are loaded, but a large routing document can still hit native read-byte limits; a rejected read is not observed evidence or retry authority.

`missing` is unknown synchronized evidence, never permission to create another refund. `observed` is also not financial completion or an assertion that every provider receipt has arrived. Reobserve when relevant data changes; the exact index discovers later inserts and metadata enrichment independently of a previously exhausted history cursor. Existing `paginateRefunds` retains its history semantics, including pinned cursors; a ten-page budget is per invocation, not a lifetime absence proof.

## Immutable correlation convention

Before the first provider execution, the host may put its existing stable opaque identity into `metadata.betterStripeRefundCommand` and its immutable fingerprint into a separate metadata field. For example, Dojo's already prepared identity `dojo-refund:<commandId>:v1` and original fingerprint can be reused without generating a replacement command or idempotency key. The package does not inject metadata or change `createRefund` parameters. Do not add this convention to an already prepared or executed provider payload if that would change parameters of a same-key replay; hold or reconcile such an older request under its actual original contract.

Command keys are 16–200 canonical ASCII letters, digits, colons, underscores or hyphens. They are correlation selectors, not credentials or authorization. Keep private data out of provider metadata. The host independently verifies the fingerprint and original terms; the reader does not equate matching metadata with permission.

Every current refund upsert normalizes existing metadata before applying incoming metadata. The first known key remains indexed. An omitted metadata field on a partial upsert adds no contradictory fact and preserves the binding. Explicitly present missing, invalid or different correlation metadata after a known binding latches a conflict, even if a later event restores the former raw metadata. Original raw provider fields are retained; correlation is a projection on the existing refund row, not another financial ledger.

`refundCommandObservedAt` is the time the normalizer first observed that binding. Neither it nor the row's insertion time proves original provider creation time. A legacy row's key is first-known component metadata, not a claim about what the original Stripe request contained. Unknown original request provenance remains the host's held reconciliation case.

## Legacy rollout hold

Any row without normalization version 1 keeps the reader unavailable globally. Otherwise an unindexed old metadata key plus an indexed newer duplicate could appear falsely unique. The indexed coverage hold is bounded and deliberately conservative, even for an unrelated legacy row.

Trusted host maintenance can drain the pending version index through `normalizeRefundCommandBindings(ctx, { limit })`, with an explicit integer limit from 1 to 100. Each transaction reads at most that many pending rows, patches only the reviewed correlation projection/version fields, then checks at most one remaining pending row. The result `{ normalized, hasMore }` reports this batch and current pending coverage. Processed rows leave the pending index, so repeat while `hasMore` is true without a full-history scan, cursor rewind or lifetime cap. Concurrent calls use Convex transactional conflict handling; a repeated call after drainage is an idempotent empty batch.

This global maintenance operation requires a trusted platform operator or internal deployment task. Never expose it to community sellers, demo personas or an unauthenticated browser. The [Vite maintenance reference](../example/convex/connect/refundCommandNormalization.ts) is deliberately an unregistered server helper. Host authentication and platform authorization must happen before calling it. Raw metadata, original account/PI/charge/currency/amount/status and financial fields remain unchanged; the same first-known-binding/conflict normalizer used by ingestion is reused. Rows without correlation become normalized unbound records; invalid reserved metadata latches a conflict. An old valid key plus an existing newer match becomes ambiguous after normalization, not falsely unique.

`hasMore: false` observes only the current trusted-writer component backlog at the transaction snapshot. It does not prove provider history is complete, prevent later legacy ingestion or authorize any refund request. A later pending row reactivates the reader’s global hold until another bounded drain. Current upserts can reobserve individual legacy rows with the same normalizer. Until all pending rows are normalized, this reader cannot report an observed unique match. Normalization coverage means only the current records written through the trusted component contract have been normalized. It does not establish complete historical Stripe ingestion, discover refunds never delivered to the component or authorize a provider retry.

## Native resource limits

The per-call limit bounds rows, not bytes. Large raw metadata can make a batch exceed native transaction read/write budgets even within the 100-row limit. Adding projection fields to an individual legacy document near the native document ceiling can also fail. This primitive does not promise capacity for every schema-legal legacy backlog.

A native failure rejects the mutation atomically: no partial normalization is committed and no completion result is returned. The unnormalized rows remain pending, so the exact reader stays held. A smaller limit can reduce batch bytes, but cannot solve an individual document ceiling. Keep that case held for investigation; do not skip/delete rows or rewrite raw metadata to manufacture completion. An empty native-dispatch check is not large-backlog capacity evidence.
