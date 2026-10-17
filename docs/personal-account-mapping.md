# Unambiguous personal account mappings

`stripe.getPersonalAccountMapping(ctx, { userId })` reads component identity
mappings without contacting Stripe. It returns the exported
`PersonalAccountMapping` discriminated union:

- `status: "unique"` includes the original account document.
- `status: "unavailable"` includes `missing`, `ambiguous`, `organization`,
  `invalid_account`, `closure_unresolved` or `closed` as its reason.

The required user selector is exact, nonempty, at most 256 characters and free of
ASCII control characters. Extra SDK options are rejected before component reads.
A successful result requires exactly one user-index match, no organization field
(including an empty organization ID), a canonical `acct_` identifier of at most
128 characters and exactly one reciprocal Stripe-account-index match pointing
to the same document. Each index read takes at most two rows. A candidate's
closure index also takes at most two rows: duplicate closure provenance, pending
closure or terminal closure makes that candidate unavailable. At most six rows
are read; there is no whole-table scan, provider read or financial write.

Two records for one user are ambiguous even when the older record was inserted
first, or one record belongs to an organization. The reader neither selects the
newest account nor migrates ownership or funds. It preserves the existing
`getAccountByUserId`, `getAccountByStripeId` and organization getters for consumers
that depend on their legacy behavior. Do not use those first-match getters as
proof of unique personal ownership.

Authenticate and authorize the enabled host actor before deriving `userId` on
the server. User IDs supplied by the browser or a Vite demo persona do not prove
authentication. For a refund, derive the original merchant from verified payment
routing first, then compare that original identifier to the unique mapping for
the authorized owner. A community ownership transfer cannot remap an old
merchant's payment to its new owner. Unknown or ambiguous mappings must remain
unavailable.

The matching Vite server binding is
[`requireOriginalPersonalAccount`](../example/convex/billing/personalAccountMapping.ts).
It takes an already-authenticated server identity and the server-verified original
account identifier, rejects a different owner, organization or replacement
account, and forwards component errors. It is a reference adapter, not a session
authentication implementation. A production host supplies its real session,
tenant authorization and immutable payment provenance.

Component mutations can reuse `resolvePersonalAccountMapping` from
`src/component/core/personalAccountMapping.ts` in their transaction; mutation
contexts satisfy its query-context database interface. This avoids duplicating
the reciprocal and closure checks when admitting an ownership binding.

A unique component mapping is identity evidence at the time of the read. It does
not prove provider freshness, merchant capabilities, settlement eligibility,
available balance or permission to create a refund. Original invoice allocation,
buyer, currency, charge, refund history and creation-time revalidation remain
separate requirements. Closed-account history uses the dedicated historical
provenance APIs; this reader never revives a closed account.

## Exact original provider-ID reads

For an immutable historical purchase link, use
`stripe.getAccountByStripeId(ctx, { stripeAccountId, requireUnique: true })` and
`stripe.getSubscriptionByStripeId(ctx, { stripeSubscriptionId, requireUnique: true })`.
The exported `AccountByStripeIdOptions` and `SubscriptionByStripeIdOptions` types
include this optional flag. Each exact provider-ID index examines at most two
matches and returns the unchanged document only when exactly one exists. Zero
matches and multiple matches both return `null`; neither result authorizes a
fallback to another account or subscription. Component errors still propagate.

Ambiguity is global to the provider ID, before any caller ownership, organization,
status or closure qualification. A canceled subscription or a closed original
account remains readable when its provider ID is unique, even when the buyer has
a different current account. This does not revive the account or establish its
current provider usability. No provider reads or writes occur. Omitting
`requireUnique`, or passing `false`, preserves the existing first-match behavior.
Component-ID getters and array readers are unchanged.

Authenticate the host viewer and derive both original IDs from its immutable
purchase record before these reads. Then compare the returned original buyer,
account, tenant and purchase bindings under the host's current authorization
policy before projecting private fields. Uniqueness alone proves none of those
bindings, provider freshness, paid access or permission to cancel or refund.
The server-only Vite reference
[`requireOriginalSubscription`](../example/convex/billing/history/originalSubscription.ts)
authenticates the actual example buyer and compares both returned records to
that buyer and the supplied trusted original association. It is not a public
browser-ID endpoint or a complete historical purchase authorization policy.
