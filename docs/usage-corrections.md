# Usage corrections and invoice adjustments

Correct the original activity through `stripe.usage.requestCorrection`. The package
retains the immutable event, original subscription/price terms, acceptance receipt,
delivery history, native outcome and quantity-accounting provenance. Corrections
never create another cash collection, transfer or commission.

Authenticate the operator and authorize the exact original activity on the server.
Resolve the payer and realm from trusted ownership records. Derive `actor` from the
signed-in operator, and use an opaque actor ID and a reason without private customer
information. A browser must not supply another payer, native proof or provider key.

```ts
const result = await stripe.usage.requestCorrection(
  ctx,
  {
    scope: original.scope,
    eventId: originalReceipt.eventId,
    correctionId: operatorCommand.id,
    actor: authorizedOperator.id,
    reason: "duplicate_activity",
    operation: "cancel",
  },
  { stripeSecretKey: process.env.STRIPE_SECRET_KEY },
);
```

Run native operations in an action or durable host worker. The same Stripe sandbox
and server-side key used by the rest of BetterStripe is sufficient. No Metronome
account or credential is required. Provider keys and raw provider error bodies do
not enter component history or workflow state.

A correction ID is immutable within its realm, payer, meter and mode. Retries keep
its original actor, reason, event and quantity. Changed requests conflict. Only one
full event-cancellation operation can claim an event. The original business source
identity stays retained, including after cancellation or a new subscription.

## Full event cancellation

For an event that has never started delivery, pay-as-you-go and included-usage
cancellation completes in the same component transaction as its terminal delivery
state and quantity restoration. Prepaid first verifies the original successful
payment, native grant and available backing. It restores only the event's original
grant allocations, without minting another grant or refunding cash.

The original `record` receipt remains unchanged. Read `getDelivery` for its current
`canceled` state. Canceled delivery cannot start or resume. Summaries retain raw
`acceptedQuantity`, and expose `canceledQuantity`, `effectiveQuantity` and
`effectiveScaledQuantity`. Included consumption and cost estimates use effective
quantity. The event and its original native receipt remain available for audit.

For provider-accepted events, BetterStripe sends a native Meter Event Adjustment
using the retained event name and native identifier. It checks the original realm,
Accounts v2 payer, mapped Customer, exact meter, subscription item, price and period.
The package uses a conservative 23-hour window after Stripe's original receipt,
within Stripe's 24-hour cancellation window. It also closes this path before the
managed billing period closes.

The native v1 adjustment response has no adjustment ID. `nativeAdjustmentId` is
therefore `null`; the stable correction operation key and original native event
identifier are retained instead. The package does not invent an adjustment ID,
retrieval endpoint or completion webhook.

A native `pending` response becomes `provider_accepted`, with
`nativeStatus: "pending"` and `restoredQuantity: "0"`. It does not prove that usage
was removed from billing. Repeating the command returns that recorded pending
outcome. A summary or invoice preview is not proof that this individual event was
canceled. An unresolved pending result needs explicit operator investigation.

A native `complete` response can restore units once only after invoice checks
before and after the request establish that billing remains open and no applicable
finalized usage invoice was found. Prepaid additionally rechecks payment/grant
backing after cancellation. If an invoice finalized during cancellation, the
result retains native completion but becomes `invoice_adjustment_required`, with
no restored units. Incomplete invoice history stays held.

Included allowance restoration updates the original period counter and keeps all
policy revisions and reservations. It does not grant units in a later period.
Prepaid restoration retains the original purchase, currency, version, rate,
allocation and expiry. Refunded, disputed, frozen, expired or unavailable backing
cannot become spendable through a correction. Use
[credit reconciliation and recovery](./usage-credits.md) for those cases.

## Unknown outcomes and recovery

A full correction holds further event delivery while it is unresolved. An
in-flight or unknown original send cannot be treated as unsent. Let the original
durable delivery workflow recover its receipt; do not fabricate provider success.

Native correction writes use one stable idempotency key. A lost response becomes
`held` with `provider_outcome_unknown`, and never restores quantity. Retrying the
same command uses that key and request. Concurrent attempts have a 15-minute lease;
a crashed attempt retains its identity and can retry after the lease. Receipt
storage failure can recover through the same retained operation rather than a
new cancellation command.

The package stops native retries 23 hours after the first correction attempt or
when the original receipt's cancellation window or billing period closes. A provably
unsent prepaid event can still complete local cancellation later after fresh
payment/grant verification; no native cancellation write is needed. The package
returns held or invoice-adjustment-required evidence for operator resolution.
Do not retry old commands under new IDs, delete an outbox entry or alter the
original occurrence time to bypass these bounds.

Confirmed full cancellation can resolve that event's validation error for
retirement while preserving every error record. The retirement audit checks at
most 100 retained validation errors and stays held if the evidence exceeds that
bound or any error lacks proven cancellation.

Pending native corrections and required financial adjustments block managed
subscription retirement and account closure. New correction work cannot start
after account closure has begun. Reads retain historical evidence.

## Partial quantities and finalized invoices

Native Meter Event Adjustments cancel a whole event. Passing an optional
`quantity` smaller than the original quantity returns `unsupported` with
`partial_event_requires_replacement_or_invoice_adjustment`. It neither changes the
original event nor restores units or stops valid delivery. Zero quantities and
amounts larger than the original are rejected. Do not send negative meter events
or change an immutable event's payload to simulate a partial correction.

A partial replacement is a separately authorized business operation, not an
implicit refund or new source identity. BetterStripe does not automatically compose
full cancellation and replacement across asynchronous native outcomes. Use an
explicit operator workflow and preserve both references if that composition is
needed. Never grant units while the original cancellation remains pending.

An expired cancellation window, a closed period or a finalized usage invoice
requires an invoice adjustment. A meter cancellation cannot establish that a
finalized invoice was reduced or that cash was refunded. Use the native Stripe
credit-note workflow and the existing authorized BetterStripe refund workflow.
Link an existing refund to the credit note when appropriate. Do not issue a second
refund merely because a credit note or usage correction is recorded.

`observeInvoiceCorrection` verifies and adopts an already issued native credit
note. It performs provider reads and records evidence. It does not create a credit
note, refund, customer-balance wallet or new financial settlement.

```ts
const observed = await stripe.usage.observeInvoiceCorrection(
  ctx,
  {
    scope: original.scope,
    eventId: originalReceipt.eventId,
    correctionId: operatorCommand.id,
    invoiceId: "in_original",
    creditNoteId: "cn_original_adjustment",
    amount: 4, // Exact positive minor currency units authorized by the operator.
  },
  { stripeSecretKey: process.env.STRIPE_SECRET_KEY },
);
```

This supports partial or full monetary adjustment against one original, unprorated
native usage invoice line in the original period and currency. The supplied amount
must exactly match the credit note. The native invoice, credit-note customer,
subscription item, price and line identities must agree. A credit note or refund
can be claimed by only one correction operation in the native realm and mode.
Changed adoption terms conflict.

For a post-payment adjustment, the reader verifies the original paid InvoicePayment,
PaymentIntent, captured Charge and succeeded linked Refund, with exact safe integer
amounts and matching currency/payer. A paid invoice alone is not proof of new cash.
Pre-payment invoice credits have no cash refund. They can even move an invoice to
`paid` by reducing its amount due to zero; that does not create payment proceeds.
A verified pre-payment credit-note void is recorded as a reversal with no cash or
unit restoration. Earlier issued evidence remains in history.

The observer returns a correction view when verified, or `{ status: "held", reason }`
when native evidence is unavailable or unsupported. Handle that union explicitly.
A verified view exposes `invoiceAdjustment` with the original amount, currency,
invoice line and any original payment/charge/refund references. `cashCollection`
always remains `"none"`.

A financial adjustment returns `resolution: "invoice_credit"`, retains valid usage
and its consumed units, and reports `restoredQuantity: "0"`. It cannot silently
cancel an event or restore credits. Existing seller/affiliate refund, dispute,
processing-cost and recovery protocols remain authoritative.

The bounded v1 observer holds incomplete pages, custom/multiple credit-note lines,
prorations, taxes/discount combinations, customer-balance or out-of-band adjustments,
pending refunds, foreign sources and unverified payment mappings. It reads at most
100 invoices in cancellation preflight and requires complete embedded invoice/note
lines. It does not turn a partial page into a successful adjustment.

Prepaid invoice-credit adoption returns `held` with
`prepaid_credit_reconciliation_required`. Billing credit-grant application,
reinstatement, purchase refunds and local quantity restoration are different
operations. Use the original credit purchase's reconciliation/refund APIs and
native credit eligibility rules. A credit note, refund or reinstated native balance
must never independently mint local spendable units.

## Scoped history and reconciliation

```ts
const correction = await stripe.usage.getCorrection(ctx, {
  scope: original.scope,
  eventId: originalReceipt.eventId,
  correctionId: operatorCommand.id,
});
const page = await stripe.usage.readCorrectionHistory(ctx, {
  scope: original.scope,
  eventId: originalReceipt.eventId,
  limit: 25,
  cursor: null,
});
const periodHistory = await stripe.usage.readCorrectionPeriodHistory(ctx, {
  scope: original.scope,
  period: original.subscription.period,
  limit: 25,
  cursor: null,
});
```

Readers enforce the exact scope and page limits of 1–100. Each history record
retains original event/subscription snapshots, request identity, actor/reason and
sanitized native/accounting evidence. The package also decodes `record`,
`subscription`, `evidence` and `recordedAt` for typed consumers. Follow the returned
cursor until `isDone`.
`coverage: "not_recorded"` means no correction evidence was recorded on that page;
it is not proof that no external or legacy correction ever happened. Undated
legacy period records set `legacyHistoryMissing`.

`getReconciliation` exposes recorded correction history when evidence exists,
including its cursor and completeness. Without evidence it preserves typed
unsupported availability. Confirmed quantity cancellation is included in local
allowance and credit/invoice reconciliation; an unproven canceled projection is
held rather than counted as a zero charge. Financial adjustments remain separate
from quantity totals.

A correction view is a retained observation, with `observedAt`; it does not poll
Stripe automatically. Re-observe native invoice adjustments when their state
changes. Loading, stale, held and partial histories must remain visible in host UI.

History is retained with limits of 100 operations per event and 1000 history rows
per operation. Quota exhaustion fails the accounting transaction atomically.
Do not delete evidence to make room or release unknown liabilities during rollback.
Use existing delivery holds while investigating and resume only work whose native
and original financial outcome is known.

Native references: [Meter Event Adjustment API](https://docs.stripe.com/api/billing/meter-event-adjustment/create),
[credit notes](https://docs.stripe.com/invoicing/dashboard/credit-notes), and
[retrieving a credit note](https://docs.stripe.com/api/credit_notes/retrieve).
