# Read and reconcile usage

BetterStripe keeps local acceptance, transport acceptance, native aggregates,
estimates and invoices separate. Start with [setup](metering-setup.md), the
[catalog](usage-catalog.md), [ledger](usage-ledger.md) and
[delivery](usage-delivery.md). Authenticate and authorize the exact Stripe realm,
payer and meter before every read, page or reconciliation call. Resolve the
original binding and subscription snapshot on the server.

## Local summaries and history

```ts
const local = await stripe.usage.getSummary(ctx, {
  scope: verifiedScope,
  period: { start, end }, // Unix seconds, half-open.
  maxRecords: 100,
});
```

The indexed summary reads at most `maxRecords + 1` immutable records, with a
budget of 1–500 and a default of 100. `complete: false` means the result is only a
bounded prefix. It never presents that prefix as a complete bill or silently
assumes missing history is zero. Use the ledger's paginated `read` to export a
larger period. An empty complete local result means no local events were found;
it says nothing about native Stripe usage.

Groups retain the original plan, version, unit, currency, customer, price and
subscription item/period. Quantities and decimal minor currency amounts are
strings. There is no combined money total across currencies or plan versions.
Each group distinguishes locally accepted quantities, transport-accepted
quantities and quantities by current delivery state. Validation-error counts
count events with observed errors, not a complete inventory of provider errors.

Pay-as-you-go estimates apply the original exact rate. Included-unit projections
require a complete original billing period and apply that period's allowance
before the overage rate. Partial periods and overlapping native subscription
items return unavailable estimates. Estimates exclude taxes, discounts, fixed
fees, rounding and other invoice lines. They are not finalized amounts or limits
that authorize work. Strict allowance reservations are implemented separately.
Prepaid balance/estimate fields remain explicitly unavailable until the prepaid
accounting APIs are configured. They never infer available credits from usage.

`read(ctx, {scope, page: {period, limit, cursor}})` returns immutable event history
with current delivery state. For an event's delivery audit:

```ts
const attempts = await stripe.usage.readDeliveryHistory(ctx, {
  scope: verifiedScope,
  eventId,
  limit: 20,
  cursor: null,
});
const errors = await stripe.usage.readValidationHistory(ctx, {
  scope: verifiedScope,
  eventId,
  limit: 20,
  cursor: null,
});
```

Both return `records`, `cursor` and `isDone`. Page sizes are 1–100; continue until
`isDone`, including an empty final page when required. Delivery history appends
started attempts, outcomes and operational holds/resumes independently of the
Workflow journal. Idempotent receipt projection does not duplicate audit entries.
`legacyHistoryMissing` identifies events whose earlier attempts predate this
history implementation. History is not reconstructed from guesses. Validation
history contains only provider samples that were actually observed. Correction
history is a typed unsupported state until the correction workflow is installed.

## Native aggregates and cached freshness

Construct one server-owned observation request using the original binding and
subscription snapshot:

```ts
const request = {
  scope: verifiedScope,
  binding: originalBinding,
  subscription: originalSubscription,
  period: { start, end },
  limit: 100,
  cursor: null,
};

// In an authorized action, with the secret resolved at execution time.
const result = await stripe.usage.reconcile(ctx, request, {
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
});

// In an authorized reactive query, without a Stripe key or network call.
const cached = await stripe.usage.getReconciliation(ctx, {
  ...request,
  maxAgeSeconds: 60,
  maxRecords: 100,
});
```

`observeProviderUsage` refreshes only the native observation.
`getProviderUsage` reads only its scoped cache. One refresh makes a bounded native
page request, with a maximum page size of 100 and zero SDK retries. There is no
automatic polling loop. Use explicit, bounded refreshes, normally at least a
minute apart, and keep transient failures visible. Cache identity includes the
original scope, binding, subscription, exact period and page request. Older
in-flight refreshes cannot replace a newer projection.

Stripe requires minute-aligned aggregate start/end times. The adapter returns
`unsupported` for unaligned periods and never rounds a billing period to hide
that difference. An empty native response is `aggregation_pending`, not zero.
An explicit native zero remains a zero observation with aggregation lag possible.
Missing pages, overlapping buckets or incomplete period coverage cannot establish
a complete total. Unsafe integer or fractional provider values are reported as
unsupported precision because this adapter submits scaled integer units. It never
rounds a provider number to fit the local quantity contract.

Cached available data carries `observedAt` and `stale`. The default freshness
limit is 60 seconds; hosts may choose 1–86,400 seconds. Fresh transport responses
can still contain lagging Stripe aggregates. `aggregationLagPossible` stays true.
Native customer/meter reads require the key's own verified account and mode and
the original Accounts v2 payer/subscription mapping. Foreign key/context modes
return typed unsupported or unavailable results.

Reconciliation returns independent `local`, `aggregate`, `comparison` and invoice/
correction availability. `observed_match` means only that complete, fresh observed
transport quantities equal the observed aggregate for that exact period. It does
not prove invoice inclusion or payment. Incomplete local history, stale/incomplete
provider data, unresolved sends and ambiguous terms prevent comparison. A
mismatch can reflect aggregation lag, external usage or validation errors.
Reconciliation never resends, cancels, reroutes or reprices billable usage.

## Invoice observations

From an authorized action, use `readInvoiceUsage(ctx, request, providerOptions)`
for a native preview. Add `invoiceId` to request a specific existing invoice.
This verifies its realm/mode, Accounts v2 payer, native customer and subscription.
The result distinguishes whole-invoice amounts from matching metered lines,
preserves full decimal quantities and nullable tiered unit amounts, and reports
whether the native line page is complete. Missing or ambiguous lines do not become
a zero meter amount. Native line periods are preserved with Stripe's semantics.

Previews remain previews. Only an existing invoice with native finalization
evidence is marked finalized. `paymentEvidence: "not_resolved"` applies even to a
paid invoice: credits or out-of-band marking can pay an invoice without new cash.
Use the separate payment-provenance and settlement APIs before distributing money.
These readers never finalize, charge, refund or settle an invoice. The generic
reconciliation result leaves invoices unavailable until explicitly observed.

Authoritative references: [native aggregate period and pagination rules](https://docs.stripe.com/api/billing/meter-event-summary/list),
[asynchronous aggregation and invoice cutoffs](https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage-api),
[invoice previews](https://docs.stripe.com/api/invoices/create_preview), and
[full-precision invoice line quantities](https://docs.stripe.com/api/invoice-line-item/object).
