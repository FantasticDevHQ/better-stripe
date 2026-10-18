# Payment-backed prepaid usage

BetterStripe tracks prepaid units against an original Stripe payment and a
price-scoped Billing Credit Grant. Stripe keeps the monetary credit ledger.
Consuming units creates a usage event, not a new payment or seller settlement.

Use this for the issuer's own services. Set ownership to issuer explicitly.
Third-party purchases and transferable wallets are unsupported. See Stripe's
[billing-credit eligibility](https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits).

## Prerequisites

Complete the [native setup](./metering-setup.md), provision a
[prepaid meter and price](./usage-catalog.md), and create an active
[managed subscription](./usage-subscriptions.md). Prepaid accounting requires
send_invoice collection. It does not attach an automatic cash collector to usage
invoices. A mismatched collection policy fails closed.

Configure the original plan on the server:

```ts
const plan = defineUsagePlan({
  key: "api-calls",
  version: "v1",
  model: "prepaid",
  unit: { name: "call", precision: 0 },
  rate: { currency: "usd", unitAmountDecimal: "2" },
  insufficientBalance: "reject",
});
```

Rates are minor currency units per whole billable unit. Quantities are decimal
strings. Each purchase and reservation must have an exact positive whole minor
currency amount. For example, 50 calls at 2 cents require 100 cents of backing.
Fractional-minor-unit consumption is rejected rather than rounded. Batch work
into an exact supported quantity when necessary.

Every host endpoint must authenticate the caller and authorize the complete
Stripe realm, test/live mode, Accounts v2 payer, meter and activity. Read the
original binding and price from server-owned configuration. Never forward a
browser-supplied scope, price, plan, reservation or purchase ID without checking
ownership. Component functions and this server facade are trusted host APIs.

## Purchase and top up

Use a unique application purchase ID for each intended purchase. Reuse it on
retry and keep its quantity, original binding, rollover and expiry unchanged:

```ts
const purchase = {
  scope,
  binding, // original native meter/price, payer and plan
  purchaseId: checkoutAttemptId,
  quantity: "50",
  ownership: "issuer" as const,
  rollover: "retain_original_terms" as const,
};
const provider = { stripeSecretKey: process.env.STRIPE_SECRET_KEY };
const result = await stripe.usage.purchaseCredits(ctx, purchase, provider);
```

This action creates or recovers one card PaymentIntent. Return clientSecret only
to that authenticated purchaser and confirm it with Stripe's payment UI. Never
persist it in documents, operation arguments, logs or Workflow state. The package
stores the PaymentIntent ID and normalized evidence.

After confirmation, call observeCreditPurchase from an authorized action or a
trusted webhook adapter:

```ts
await stripe.usage.observeCreditPurchase(ctx, purchase, provider);
```

Its fresh native read verifies successful capture, amount, currency, payer,
realm/mode and original metadata. Pending or failed payments do not grant units.
It then creates or recovers one paid Credit Grant scoped to the original price.

Read getCreditPurchase reactively with scope, binding and purchaseId to show
pending, ready, frozen or canceled. Ready requires verified payment and durable
grant persistence. Duplicate and out-of-order notifications trigger fresh native
reads and cannot grant twice.

Payment and grant creation have separate durable retry windows. The grant window
starts when payment success is first persisted, so delayed payments can complete.
Missing pinned resources, ambiguous discovery or an unknown create outside its
23-hour window requires reconciliation. A new purchase ID must not bypass a hold.

Each top-up is another purchase with a new ID. A host can implement a threshold
policy using getCreditBalance and its authenticated payment-confirmation flow.
The package does not silently charge a saved card or convert exhausted prepaid
work into pay-as-you-go billing.

## Reserve, perform work and record

Reserve before work that must fit the prepaid cap:

```ts
const event = {
  scope,
  binding,
  sourceEventId: job.id,
  quantity: "6",
  occurredAt: job.originalUsageTimestamp,
};
const reservation = await stripe.usage.reserveCredits(ctx, {
  event,
  subscription, // original item and half-open billing period
});
if (reservation.state === "reserved") {
  await performIdempotentWork(job); // host deduplicates work under job.id
  await stripe.usage.record(ctx, {
    event,
    subscription,
    reservationId: reservation.reservationId,
  });
}
```

A committed reservation means work was already accepted. A released reservation
means the host explicitly abandoned it. Do not rerun work simply because a client
retries. Acceptance commits the exact reservation in the same transaction as its
immutable event and outbox. Original time, quantity, customer, price/version and
subscription snapshot cannot change on replay.

Concurrent reservations cannot spend the same units. UsageCreditError exposes
insufficient_credits when eligible backing cannot satisfy a reservation.
Allocation uses earliest expiry, effective time, creation time and native grant
ID. One reservation can partially consume a grant and uses at most ten grants.

If work definitely never completed, release its uncommitted reservation:

```ts
await stripe.usage.releaseCredits(ctx, {
  scope,
  reservationId: reservation.reservationId,
  reason: "work_failed", // or "abandoned_before_work"
});
```

There is no automatic timeout release. A worker crash does not prove that work
failed. Resolve the host's job outcome first. Committed, unknown or held usage
retains its backing and requires an auditable correction.

Use the [existing delivery API](./usage-delivery.md). Prepaid delivery also checks
the original payment, grant, scope, expiry and current native ledger balance.
Changed backing requires reconciliation. Refund/dispute evidence freezes further
spending. Delivery does not create a payment or collect an invoice.

## Expiry, rollover and price changes

Omitting expiresAt creates non-expiring original-term credits. Explicit expiry
must cover the current billing period plus 72 hours for finalization.
Reservations enforce that coverage for their own period. Native credits apply
at invoice finalization, not when work reserves units.

The retain_original_terms policy preserves remaining units across renewal under
the same original binding until expiry. Different prices, units, currencies,
modes and plan versions have separate ledgers. There is no automatic conversion,
promotional grant or reset of consumed units.

The live balance is a quantity projection, not money available for withdrawal.
Reserved and consumed quantities stay separate from native credit application.
Check eligibility through reserveCredits, since a future expiry may not cover
the whole billing period even while units remain unexpired.

## Read and reconcile

Use getCreditBalance, readCreditGrants and readCreditHistory. Pages accept a limit
from 1 to 100 and an opaque nullable cursor. History retains purchase, payment,
grant, reservation, commit, release, native transaction, recovery and closure
provenance.

```ts
const state = await stripe.usage.reconcileCreditPurchase(
  ctx,
  purchase,
  provider,
);
```

Reconciliation reads grant-filtered native credit balances and transactions.
Each funded invoice line must match original local quantities, item, period and
successful delivery. Original price amounts must be covered by native credits.
Incomplete history, foreign references, proration and unexpected consumption
hold the projection. After resolving a temporary observation hold, reconcile every\ngrant again and call resumeCreditAccount. Resume requires fresh complete proofs\nand cannot release unresolved refunded, disputed or consumed liabilities.

The pendingFinalizationAmount separates committed usage from native credit
application. cashCollection is always none. Invoice payment evidence remains
not_resolved. Paid status, credit application and previews do not prove new cash
or authorize seller/affiliate settlement.

An invoice void can restore native credit, but does not recreate spent units in
this ledger. A credit note does not itself restore a Stripe Credit Grant. Both
require explicit correction provenance. See
[Stripe's reinstatement rules](https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits#void-invoices-and-issue-credit-notes).

Reconciliation is bounded to 100 native transactions and ten invoice proofs per
grant. Larger or incomplete histories are held, never assumed complete. The
component retains at most 1,000 purchases and 100,000 audit entries per original
binding. Quota exhaustion blocks new work without deleting financial history.
Plan an explicit capacity and archival policy before reaching those bounds.

Native allocation can differ from local reservation allocation. Unproven
comparisons require reconciliation. External Stripe Dashboard changes can also
require operator recovery; the local reservation cap does not lock Stripe.

## Cancellation, refunds and closure

cancelCreditPurchase cancels only an original unpaid PaymentIntent in a
supported cancelable state. It never replaces a missing identity or cancels a
successful payment. Retry ambiguous cancellation under the same purchase.

For wholly unused paid credits:

1. Call prepareCreditRefund. It requires current reconciliation and no reserved
   or consumed units. It freezes the grant and confirms native expiration.
2. Use BetterStripe's existing createRefund for the returned original
   paymentIntentId, with host authorization and a stable refund idempotency key.
   Preparation returns cashRefund as required; it does not claim money moved.
3. Reconcile again to preserve fresh native refund and expiration evidence.

Partial consumption, pending work, disputes, invoice voids and partial refunds
are recovery cases. The component freezes affected units and retains liabilities.
It does not silently restore units, refund twice or settle consumption as a sale.

Close the managed subscription through its normal usage closeout first.
closeCreditAccount requires no pending purchases/reservations, complete native
zero-balance evidence and reconciled consumption. Unspent paid credits require a
verified full refund unless they expired under their original configured terms.
The general account-closure API checks open prepaid ledgers for payer and realm.

## Verification and agent setup

Run pnpm run check:all. Focused tests exercise the public facade and actual Stripe
SDK transport, database-failure recovery, concurrent reservations, invoice
provenance, expiration, cancellation and refunds.

Use the existing Stripe sandbox and test key. No Metronome account or token is
required. Keep secrets in the runtime environment and follow the
[setup guide](./metering-setup.md). The sanitized
[native finalization evidence](./evidence/native-metering/clock-finalization-run.json)
demonstrates purchased native credit covering usage without a second usage
charge. Clock advancement is not ingestion proof. Observe the meter aggregate
before advancing, then inspect the finalized invoice.
