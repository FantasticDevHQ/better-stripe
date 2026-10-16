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
