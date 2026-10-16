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

`missing` is unknown synchronized evidence, never permission to create another refund. `observed` is also not financial completion or an assertion that every provider receipt has arrived. Reobserve when relevant data changes; the exact index discovers later inserts and metadata enrichment independently of a previously exhausted history cursor. Existing `paginateRefunds` retains its history semantics, including pinned cursors; a ten-page budget is per invocation, not a lifetime absence proof.

## Immutable correlation convention

Before the first provider execution, the host may put its existing stable opaque identity into `metadata.betterStripeRefundCommand` and its immutable fingerprint into a separate metadata field. For example, Dojo's already prepared identity `dojo-refund:<commandId>:v1` and original fingerprint can be reused without generating a replacement command or idempotency key. The package does not inject metadata or change `createRefund` parameters. Do not add this convention to an already prepared or executed provider payload if that would change parameters of a same-key replay; hold or reconcile such an older request under its actual original contract.

Command keys are 16–200 canonical ASCII letters, digits, colons, underscores or hyphens. They are correlation selectors, not credentials or authorization. Keep private data out of provider metadata. The host independently verifies the fingerprint and original terms; the reader does not equate matching metadata with permission.

Every current refund upsert normalizes existing metadata before applying incoming metadata. The first known key remains indexed. An omitted metadata field on a partial upsert adds no contradictory fact and preserves the binding. Explicitly present missing, invalid or different correlation metadata after a known binding latches a conflict, even if a later event restores the former raw metadata. Original raw provider fields are retained; correlation is a projection on the existing refund row, not another financial ledger.

`refundCommandObservedAt` is the time the normalizer first observed that binding. Neither it nor the row's insertion time proves original provider creation time. A legacy row's key is first-known component metadata, not a claim about what the original Stripe request contained. Unknown original request provenance remains the host's held reconciliation case.

## Legacy rollout hold

Any row without normalization version 1 keeps the reader unavailable globally. Otherwise an unindexed old metadata key plus an indexed newer duplicate could appear falsely unique. The indexed coverage hold is bounded and deliberately conservative, even for an unrelated legacy row.

A separate legacy-normalization capability must drain the pending version index through bounded trusted-host calls; that drain is not implemented by this reader. Current upserts can reobserve individual legacy rows with the same normalizer. Until all pending rows are normalized, this reader cannot report an observed unique match. Normalization coverage means only the current records written through the trusted component contract have been normalized. It does not establish complete historical Stripe ingestion, discover refunds never delivered to the component or authorize a provider retry.
