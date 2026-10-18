# Metered subscriptions and invoice lifecycle

Use [native setup](metering-setup.md) and the [catalog APIs](usage-catalog.md)
first. `stripe.usage` provides managed subscriptions for pay-as-you-go, monthly
included usage with overages, and prepaid usage. Each uses the original native
meter/price binding. Purchased prepaid grants and strict allowance reservations
are separate accounting APIs. Creating a subscription does not fund credits or
authorize consumption.

## Create a metered or mixed subscription

Authenticate the caller and authorize the entire realm, Accounts v2 payer and
every meter on the server. Resolve `meters` from server-owned catalog bindings.
Do not accept a browser-supplied payer, price, plan, quantity or arbitrary JSON
for a component mutation. The native key must own the requested realm and mode.
The component verifies the Accounts v2 payer's native customer mapping.

```ts
const signup = {
  requestId: activity.subscriptionSignupId, // Stable across retries.
  meters: [{ scope: verifiedScope, binding: originalBinding }],
  fixedPriceIds: [], // Optional monthly licensed prices, e.g. a base fee.
  collection: { method: "send_invoice" as const, daysUntilDue: 30 },
};
const current = await stripe.usage.ensureSubscription(ctx, signup, {
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
});
```

For automatic collection, use
`{method: "charge_automatically", defaultPaymentMethod: attachedPaymentMethodId}`.
The payment method must belong to the authorized payer. Initial payment can be
incomplete; an incomplete subscription is not permission to deliver work.

A request supports 1–10 unique meters and up to 10 fixed prices, in one currency,
realm, mode and payer mapping. All items use monthly prices. Managed creation
uses native flexible billing. Metered items omit `quantity`; fixed items use one.
Tiered rates remain nullable in native item observations. Display the original
plan's exact rate and unit rather than treating a nullable native rate as zero.
Fixed fees, taxes and other invoice lines are separate from metered line amounts.

The component persists immutable signup terms and atomically locks each native
customer/meter before creation. Changed terms under the same request ID conflict.
Concurrent payer aliases cannot reserve that native customer/meter twice. Native
subscription discovery is bounded to ten pages of 100. Active overlapping meter
subscriptions, incomplete item pages and ambiguous identities block creation.
Use managed enrollment for every writer in that realm. Component locks cannot
serialize independent Dashboard/API writers or unrelated external Checkout
sessions; preflight checks detect existing native overlaps, and hosts must
prevent concurrent external enrollment.

A stable Stripe idempotency key and retained native ID survive component write
failures. An absent pinned object never triggers recreation. Recovery can discover
a matching original subscription; an unresolved create is held after 23 hours
instead of sending a new billable request after Stripe's idempotency window.
Keep the original request ID and resolve that outcome before starting another.
Provider errors contain fixed messages and typed `UsageSubscriptionError.code`
values, without raw Stripe response bodies or credentials.

## Checkout

Use the same original bindings with a Checkout collection policy:

```ts
const session = await stripe.usage.ensureCheckout(
  ctx,
  {
    ...signup,
    collection: {
      method: "checkout",
      successUrl: "https://your-app.example/billing/success",
      cancelUrl: "https://your-app.example/billing",
    },
  },
  { stripeSecretKey: process.env.STRIPE_SECRET_KEY },
);
```

Redirect to the returned `url` only while its status is `open`. Open, completed
and expired sessions retain their original identity. An expired signup is not
silently replaced. A completed session exposes its verified subscription after
native retrieval. The redirect is not payment or enrollment evidence; use the
subscription and invoice observations. Pending signup locks stay held until the native outcome is reconciled,
preventing another concurrent signup. For a verified expired session with no
subscription, PaymentIntent or SetupIntent and no payment received, call
`abandonSignup(ctx, ref, providerOptions)`. The same API supports a verified
`incomplete_expired` subscription only when its original initial invoice is void
and unpaid, with no recorded usage or pending reservations. It retains the
original terms and closure evidence, then permits a new request ID. Unknown
creates, incomplete payments and unresolved financial references stay held.

## Read current terms and retained history

The subscription reference has no single meter because a subscription can contain
several:

```ts
const ref = {
  scope: {
    stripeAccountId: verifiedScope.stripeAccountId,
    customerAccount: verifiedScope.customerAccount,
    livemode: verifiedScope.livemode,
  },
  requestId: signup.requestId,
};
const cached = await stripe.usage.getSubscription(ctx, ref); // Reactive query.
const refreshed = await stripe.usage.observeSubscription(ctx, ref, {
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
});
const history = await stripe.usage.readSubscriptionHistory(ctx, {
  ...ref,
  kind: "subscription",
  limit: 20,
  cursor: null,
});
```

The managed mirror includes every item, original source binding and actual
collection policy. Native collection method, invoice due days and configured
automatic payment method must match the original agreement. Delivery verifies
that policy again immediately before sending. Each metered binding contains its own native subscription/item/price
and half-open Unix-second period. Renewals produce a new snapshot; prior periods
remain immutable. Refresh before authorizing current work. Cached observation
times are not a guarantee of current native state. Historical prices are never
replaced by current prices. Changed or incomplete native items return an error
until their provenance is resolved.

History supports `subscription`, `invoice` and `retirement`, bounded pages of
1–100 and `isDone`/`cursor`. Continue until done, including an empty final page
when necessary. Duplicate snapshots deduplicate; older in-flight observations
cannot replace a newer current projection. Each enrollment retains at most
100,000 immutable history observations. Exhaustion blocks new writes and requires
an explicit archival/migration plan; financial evidence is never automatically
deleted. Existing fixed-price APIs remain compatible and retain their existing
read contracts. Use these managed readers for the full metered item list.

Managed subscription and invoice webhooks re-read native state before projection.
They retain the `bsUsageIntent` marker created by the package. Preserve that
metadata and the configured webhook routes. Older signed payloads cannot directly
rewind managed state. Native lookup failures leave the webhook retryable with a
fixed redacted error. Hosts may also refresh explicitly after downtime.

## Closeout, cancellation and model changes

Managed v1 closes new acceptance and new delivery attempts 60 seconds before the
original period ends. This is an operational buffer, not proof of invoice
inclusion. New acceptance requires the original active managed binding; receipt
replays still return the original record after closeout. New usage is rejected
when the native period/binding is closed or has changed. Queue work for the next
verified service period before it runs; do not move completed activity's original
timestamp, source ID or pricing to make it billable again.

Delivery rechecks the cutoff after preflight and reserves transport time before
sending. Queued usage that reaches closeout becomes held with
`billing_period_closed`. In-flight responses remain recorded, including unknown
outcomes. Inspect [delivery history](usage-delivery.md), native aggregates and
invoices; resolve held/unknown/rejected usage through the correction workflow.
Neither a clock advance nor an API receipt proves ingestion or invoicing.

```ts
await stripe.usage.setCancelAtPeriodEnd(
  ctx,
  {
    ...ref,
    operationId: cancellationCommandId,
    cancelAtPeriodEnd: true,
  },
  providerOptions,
);
```

Use a new command ID with `cancelAtPeriodEnd: false` to undo scheduled cancellation
before Stripe cancels the subscription. Commands serialize per enrollment, reject
changed retries, retain unknown outcomes, and stop blind writes after 23 hours.
A replay returns the original command result; refresh separately for current
state. A canceled native subscription cannot be reactivated.

There is no managed immediate-delete, mid-cycle price swap, automatic proration,
credit conversion or account-closure shortcut. Native mid-cycle changes can omit
old or late usage, including in flexible billing. Use period-end cancellation,
drain delivery and resolve reservations, then observe the final period invoice.
An account closure must follow the same closeout process before deactivating its
customer configuration or credentials. External changes are detected on refresh;
they never rewrite retained events. Existing generic APIs can still perform their
own operations; they do not acquire these managed safeguards.

After native cancellation, a finalized cycle invoice covering the closed period,
and no pending local sends, validation errors, reservations or cancellation
commands, retire the enrollment:

```ts
await stripe.usage.retireSubscription(
  ctx,
  { ...ref, invoiceId: finalInvoiceId },
  providerOptions,
);
```

This releases its enrollment locks so a new request ID can configure a new model
or price. Original events, invoices, purchases and credits remain associated with
their original terms. Retirement does not establish payment or exact invoice
reconciliation; its result explicitly retains `billingReconciliation: "required"`.
No historical activity is copied or rebilled. Unused credits do not become credit
on a new price or currency. Resolve their original expiry/refund policy separately.

## Invoice evidence and late usage

`observeSubscriptionInvoice(ctx, {...ref, invoiceId}, providerOptions)` verifies
native realm/mode, payer, subscription and original metered item references,
then retains a bounded observation for each configured meter. Historical line
periods and prices remain native evidence. Missing/incomplete lines stay
unavailable, never an inferred zero. Whole-invoice totals include fixed lines;
matching meter amounts remain separate. Use `readInvoiceUsage` for previews as
described in [usage observations](usage-observations.md). Managed history retains
existing invoice observations, including finalized and paid status.

A paid invoice can be covered by credits or marked paid out of band. Its
`paymentEvidence` stays `not_resolved`. Prepaid application must not create a new
usage payment or seller settlement. Verify actual payment provenance separately
before distributing money. These managed readers do not finalize, charge, refund
or settle invoices.

Stripe accepts eligible meter events within its ingestion window, but late
acceptance does not guarantee invoice inclusion. Configure and verify the native
invoice finalization grace period for your delivery latency. Only applicable
cycle/phase-transition invoices collect grace-period usage. Threshold and initial
invoices have earlier cutoffs, and mid-cycle price changes have additional late
usage limitations. Do not resend accepted usage under a new ID to fix an invoice.

## Verify native test-clock behavior

From the repository root, using the test-only secret reference configured in
[setup](metering-setup.md):

```sh
op run --env-file=.env.metering -- node scripts/metering-sandbox.mjs \
  --verify-test-payment --finalize-test-invoices
```

This test-only probe attaches a test clock when first configuring the Accounts v2
customer, creates all three metered subscriptions, and confirms the 15-unit native
aggregates before advancing a billing period. It waits for clock readiness,
retrieves period-end invoices and explicitly finalizes a matching draft when
needed. It reports native totals and identity/finalization checks separately from
payment evidence. Expected totals are 30 USD cents for pay-as-you-go, 10 cents for
included overages and zero for credit-covered prepaid consumption. The prepaid
purchase is a separate 100-cent test payment. Synthetic usage uses the clock's
frozen timestamp. A bounded final re-read handles delayed aggregates before any
billing-clock advancement. Cleanup expires the grant, requests
its test refund, cancels subscriptions, archives catalog resources and deletes the
clock. Inspect every cleanup result.

This probe does not prove production clock behavior, application settlement or
strict credit reservation accounting. It creates synthetic sandbox resources and
rejects live keys before requests. Clock advancement is not evidence that meter
ingestion has completed. Keep the sanitized output as reviewer evidence and
report lag or unsupported account modes explicitly.

The [successful sandbox run](evidence/native-metering/clock-finalization-run.json)
confirmed all three 15-unit aggregates, final totals of 30/10/0 USD cents, the
separate paid prepaid purchase and all 15 cleanup requests. The
[earlier bounded lag run](evidence/native-metering/clock-lag-run.json) confirmed
only the first two aggregates and stopped before clock advancement. Both are
retained so missing data cannot be mistaken for a zero charge or successful
finalization.

Primary references: [native usage cutoff rules](https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage-api),
[finalization grace periods](https://docs.stripe.com/billing/subscriptions/usage-based/configure-grace-period),
[flexible/classic changes and cancellation](https://docs.stripe.com/billing/subscriptions/usage-based/manage-billing-setup),
and [Accounts v2 test clocks](https://docs.stripe.com/billing/testing/test-clocks/api-advanced-usage),
[expired Checkout sessions](https://docs.stripe.com/api/checkout/sessions/expire),
and [initial payment expiry](https://docs.stripe.com/billing/subscriptions/overview).
