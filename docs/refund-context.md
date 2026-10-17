# Refund context observation

`BetterStripe.getRefundContext(ctx, options)` reads one original PaymentIntent,
its captured charge and a bounded refund history after actor authorization. It
performs no provider write, component synchronization, transfer reversal or
access/subscription change. It complements the existing public React `Refunds`
review workflow; no additional renderer is required.

```ts
const context = await stripe.getRefundContext(ctx, {
  stripePaymentIntentId: originalPayment.stripePaymentIntentId,
  actor: { type: "seller", accountId: originalMerchantAccount },
  maxRefundPages: 5,
});
if (context.status === "ready") {
  // Original currency minor units; revalidate before creating the refund.
  const remaining = context.remainingRefundableAmount;
}
```

## Authority and original scope

The required `actor` is either `{ type: "seller", accountId }` or
`{ type: "admin" }`. Runtime validation rejects missing or malformed actors and
noncanonical `pi_`/`acct_` selectors before component or provider reads. Sellers
must own the original destination or `store` split leg; affiliate and collaborator
legs do not confer refund authority. Admin authority must be established by the
host. The legacy optional actor on `createRefund` is not inherited by this reader.

The original synchronized payment must exist. Its V2 buyer account is correlated
with the live PaymentIntent; the original currency, PaymentIntent, latest charge
and charge's PaymentIntent reference must agree. Nullable legacy customer
references must also be canonical and agree; they do not replace the V2 buyer.
Malformed provider objects or contradictory lifecycle flags cannot produce a
ready result. A disputed, uncaptured or zero-captured charge is unavailable.

`stripeAccountId`, when supplied, is a **server-owned provider request scope**,
not the buyer account or merchant identity. Derive it from the original payment's
known charge context. Never accept it or the actor from browser input. The Vite
server-only `example/convex/connect/refundContext.ts` reference intentionally
supports platform charges only, derives the personal seller mapping and verifies
original merchant ownership. Demo personas still require real authentication in
a production host; the helper registers no public endpoint.

## Result and units

Public types are `RefundContextOptions`, `RefundContext` and
`RefundContextUnavailableReason`. A ready result contains `stripePaymentIntentId`,
`stripeChargeId`, `customerAccount`, `currency`, `capturedAmount`, `refundedAmount`,
`remainingRefundableAmount` and `observedAt` (milliseconds).

Amounts remain safe integer minor units in the original currency; no conversion
or fixed two-decimal assumption is applied. `capturedAmount` comes from
`charge.amount_captured`, checked against `paymentIntent.amount_received`.
Authorized `paymentIntent.amount`, `charge.amount` and synchronized payment
amount can exceed a partial capture and are not refund limits. `refundedAmount`
is the complete succeeded-refund total, reconciled with `charge.amount_refunded`.
The full-refund flag must agree in both directions with whether that total equals
captured principal. The remaining amount is captured principal minus that total. Dispute principal,
processing fees, balance transactions and invoice allocations are not subtracted
or substituted into this calculation.

An unavailable result has only `{ status: "unavailable", reason }`, with no
invented zero balance. Provider failures reject with their original identity so
callers can retry rather than present a completed observation.

## Bounded completeness and host obligations

Each refund page is requested explicitly with limit 100. `maxRefundPages` defaults
to 5 and accepts integers 1–10. Every observed row must have a canonical refund
identity, matching charge, PaymentIntent and currency, and a known lifecycle.
Pending or requires-action refunds block ready; failed/canceled refunds do not
count as returned principal. Unknown states, malformed or oversized envelopes,
duplicate IDs anywhere in the bounded traversal, exhausted nonterminal pages,
unsafe amounts and counter disagreements return unavailable.

`observedAt` is an observation, not a reservation or immutable snapshot. Hosts
must authenticate the actual session, authorize tenant/community and original
merchant scope, and revalidate immediately before `createRefund`. Invoice
`amount_paid` is allocated principal for that invoice, not the whole
PaymentIntent's refund authority. Deny ambiguous cross-invoice/community scopes
until a safe original-payment binding is established. A ready zero remainder
must not enable another refund. This reader does not grant authority to remove
access, cancel a subscription or change the original financial recipients.

## Current refund synchronization

`betterStripe.syncRefundFromStripe(ctx, { stripeRefundId, scope })` is a separate
trusted-host operation. It retrieves the current provider refund and synchronizes
the existing component refund/payment projection. It never creates or cancels a
refund, reverses transfers, changes access or authorizes a retry. Hosts must
authenticate and authorize the original refund and provider API scope before
calling it; the method is not an application authorization boundary.

```ts
const observation = await betterStripe.syncRefundFromStripe(ctx, {
  stripeRefundId: originalRefundId,
  scope: { type: "platform" },
});
// Or use { type: "connected", accountId: trustedOriginalApiAccount }.
```

The API namespace is required and runtime validated before component/provider
access. A connected API account is not a buyer, destination merchant or seller
entitlement. Provider metadata cannot select that account. Original merchant
attribution uses the existing immutable store-allocation proof, or the original
charge's destination when needed to qualify a legacy destination fallback.
Known original merchant/PI/charge/currency/amount disagreement or ambiguous evidence
holds the observation. An unattributed refund can remain unattributed where no
legacy destination fallback would invent an owner. This does not establish seller
authorization or historical ingestion completeness.

Each current read receives a durable per-refund generation. Only the newest
claimed generation can commit the qualified snapshot and existing cumulative
payment projection together. An older completion returns `superseded` without
writing that snapshot, including when the newer read failed. Superseded is not
proof that any newer observation succeeded. `accepted` returns the generation,
`changed` and stored refund; it is an observation, not financial completion.
Current `succeeded` may legitimately become `requires_action`, `pending` or later
failure. No status ordering, provider revision or webhook timestamp is invented.

Provider or accepting-transaction failures propagate rather than falling back to
a notification snapshot. A failed pending generation is marked unknown when that
marker can be saved. Lost responses can leave a pending or accepted generation;
a fresh explicit observation obtains a new generation. It does not dispatch a
refund. The original cumulative writer remains a complete indexed collection of
all refund rows for the payment, excluding failed/canceled contributions. Failed
history is not cardinality bounded: native resource limits can abort the whole
accepting transaction, preserving the last committed projection. There is no
partial sum, silent truncation or all-backlog-capacity guarantee.

This primitive does **not** yet route the legacy signed refund webhook pipeline
through generation qualification. Legacy `upsertRefund` and raw callbacks remain
unfenced; they can still overwrite observations outside this operation. The
separate shared-pipeline integration must preserve generation qualification
through its callback transaction before hosts claim webhook-wide convergence.
The server-only Vite reference is
[`example/convex/connect/refundSync.ts`](../example/convex/connect/refundSync.ts).
