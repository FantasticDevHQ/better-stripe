# Run all three native billing models

The example at `/demo/metered-usage` uses the public BetterStripe package against a
Stripe sandbox. It provisions a dedicated Accounts v2 customer, test clock,
product, meter, price and managed subscription per persona and model. Usage,
delivery, allowance reservations, credits, corrections and settlement live in the
component. The example stores fixture provenance and synthetic application work.

Start with [sandbox setup](metering-setup.md). Use your existing Stripe sandbox;
no Metronome account or token is needed. Run the example backend and frontend
from the `example` directory with `pnpm dev`. Keep test keys in the backend
Convex environment. Do not copy secret values into commands, screenshots, source
files or browser storage.

## Demo security model

This repository's persona switcher is a test-only convenience, not authentication.
Choose Customer, Seller or Admin, then Metered billing. Each operation rechecks
the server's persona binding and test key. If an authenticated identity is present,
it must match the persona's stored token identifier. Visitor and affiliate
personas cannot operate the workflow. Do not expose these demo endpoints as a
production billing service.

In your app, replace the persona lookup with real authentication and server-owned
customer, product, entitlement and recipient authorization. Never trust a browser
account ID, product ID, price, rate or settlement policy. See
[authorization and recovery](usage-security.md).

Admin and seller personas can configure the unit, precision, currency, exact price,
version and model-specific terms before setup. Customers run the server-owned
defaults. Setup retries retain the original native identities and configuration.
A saved meter and subscription keep their original terms. Archive a resolved run
before configuring its replacement.

## Pay as you go

1. Select Pay as you go, then Set up sandbox.
2. Run five units three times. The default price is USD 1 per call.
3. Replay last work. Its source identity, quantity and occurrence time stay fixed;
   the synthetic application work and usage acceptance happen once.
4. Observe native usage. If delivery is queued, use Resume queued deliveries.
   Stripe aggregation is asynchronous. Refresh until the aggregate is 15.
5. Close or resume original billing period. This fences new work, checks complete
   local/native equality, drains reservations and checks every correction and
   purchase intent. It advances only this run's test clock.
6. Resume after the clock is ready. The server finds the unique original cycle
   invoice, verifies its meter lines, finalizes it and pays with Stripe's sandbox
   card. The default invoice is USD 15.

The outcome separately shows invoice payment, original cash verification, actual
processing fees and any verified recipient transfers. A paid invoice alone does
not imply that settlement is ready.

## Included monthly usage and overages

Select Included monthly usage. The defaults include ten calls per original
monthly period, then USD 1 per additional call. Run three five-unit jobs. The
package allowance view shows 15 consumed, ten included, five billable overage
units and the soft-limit warning at 12. The native invoice is USD 5.

Closing the period observes the next native subscription period. When that period
is active on the Convex server, its separate allowance starts at zero consumed
and ten remaining included units. The old period and history stay unchanged. A
test clock can move ahead of real time; future renewal allowance is explicitly
unavailable. Its view stays read-only until the period is active on the server and
new event times are inside the provider's real acceptance window. This demo does not forge
future work timestamps to simulate another month's consumption.

## Paid prepaid credits

1. Select Prepaid credits and set up its dedicated sandbox resources.
2. Run five units before funding. Work is held and does not execute.
3. Create credit purchase. The default original purchase is ten units for USD 10.
   Pending payment grants no usable credit.
4. Confirm sandbox card. The backend uses Stripe's test card and the package
   verifies the original captured PaymentIntent, customer and paid credit grant.
5. Run two five-unit jobs. Replay a successful job before creating another one to
   demonstrate idempotency. Another five-unit job is denied after exhaustion.
6. Observe native usage, then close and resume the period. The native credit grant
   covers the consumption invoice. The demo refuses to pay any positive prepaid
   invoice remainder with a second cash payment.

The USD 10 purchase is the only cash source. Credit consumption collects no new
cash. The package reconciles native credit transactions against complete invoice
history. Unavailable observations are shown explicitly, never as a zero balance.

For production, send the package purchase result's `clientSecret` only to the
properly authenticated purchaser's Stripe payment UI. Do not store or log it.
Confirming a payment in the UI is not proof of usable credits; call
`observeCreditPurchase` and wait for the verified ready grant. See
[paid credit accounting](usage-credits.md).

Prepaid is limited to the issuer's own services. A seller persona cannot redeem
credits into reseller proceeds. An authorized affiliate can be paid once from the
original purchase; usage does not produce another affiliate sale.

## Corrections and retained failures

Before closing, Correct last accepted event cancels its original native event
through the package. Repeated correction requests keep the same correction ID.
Wait for confirmation and native reaggregation. A new application job can then
use the released capacity. For example, record 15 units, cancel the last five,
then record a different five-unit job. Effective usage is 15, and history retains
20 originally accepted units plus the five canceled units.

Unknown delivery outcomes stay held. Resume queued deliveries schedules only
records that the package still classifies as queued; it never resends unknown
attempts. Do not replace the source event ID, change the occurrence time, create
a new run to relabel the same work or invent a provider event identifier. Resolve
the original attempt with verified native evidence using the operational runbook.
A billing or cleanup guard failure preserves all work, purchase and correction
intents for reconciliation.

The fixture timestamps _new synthetic jobs_ at its retained test clock's original
period start. This keeps native meter events and paid grants on the same logical
clock. Retrying a job never changes that timestamp. Real applications must use
the actual occurrence time of their business event. Delivery checks both real
provider limits and an attached sandbox clock before a native event write.

## Ownership and routing

Customer and admin runs use direct issuer billing. Seller runs pin their original
server-owned seller account and, when available, an existing demo affiliate at
setup. The demo policy is a 10% inclusive platform fee and a 20% affiliate share
of the eligible remainder, with recurring commission eligibility. The package
uses actual processing fees and verifies native payment provenance, recipient
capabilities and transfer identity. Unsupported Connect configurations remain
held. Accounts v2 payer configuration is separate from merchant or recipient
configuration; a customer account is not automatically eligible to receive money.
Prepaid settlement retains issuer revenue and accepts only eligible affiliate
policy, never seller or collaborator redemption.

## Scoped cleanup and reset

Cleanup re-reads the original paid invoice, payment and settlement before stopping
resources. Saved success alone cannot authorize a reset after a refund, dispute or
incomplete settlement recovery. Unavailable fresh evidence keeps the run retained.

Use Archive or resume scoped cleanup after the original invoice and cash evidence
are verified. It refuses unresolved delivery, corrections, reservations, purchases,
credit backing or settlement. Unspent paid credits require verified refund or
expiry; cleanup cannot wipe them.

Cleanup requests period-end cancellation, advances only the owned test clock to
the cancellation boundary, checks the final native cycle invoice and retires the
managed enrollment. It deactivates only the owned price, meter and product. It
retains the native payer, clock, invoice/payment evidence and every component
history record. It does not clear any Convex table or another developer's data.
After successful archival, Start new sandbox run creates new isolated resources.
Admin or seller can save a new version before starting that replacement.

Empty or unresolved runs can require operator reconciliation rather than automatic
archive. In particular, unknown provider outcomes must remain visible and retained.
Never delete a clock or payer to make financial evidence disappear.

## Model configuration snippets

Use the same versioned unit and exact minor-currency rate in each model:

```ts
import { defineUsagePlan } from "@fantastic.dev/better-stripe/usage";
const terms = {
  key: "api-calls",
  version: "v1",
  unit: { name: "call", precision: 0 },
  rate: { currency: "usd", unitAmountDecimal: "100" },
} as const;
```

Pay as you go bills every effective unit:

```ts
const payAsYouGo = defineUsagePlan({ ...terms, model: "pay_as_you_go" });
```

Included monthly usage grants ten units before overages in each original period:

```ts
const included = defineUsagePlan({
  ...terms,
  model: "included_overage",
  includedQuantity: "10",
  reset: "billing_period",
});
```

Prepaid consumption requires verified paid grants and rejects insufficient credit:

```ts
const prepaid = defineUsagePlan({
  ...terms,
  model: "prepaid",
  insufficientBalance: "reject",
});
// After server authorization and native binding setup:
const purchase = await stripe.usage.purchaseCredits(
  ctx,
  {
    ...originalCreditBinding,
    purchaseId: originalBusinessPurchaseId,
    quantity: "10",
    ownership: "issuer",
    rollover: "retain_original_terms",
  },
  { stripeSecretKey },
);
// Return clientSecret only to the authorized purchaser's payment UI.
// Observe the original purchase after payment; wait for its ready grant.
```

Use `ensureUsageMeter`, `ensureUsagePrice` and `usage.ensureSubscription` to bind
the chosen plan to the server-authorized native payer. The exact implementations
are in the example's `meteredUsage/setup.ts` and `meteredUsage/funding.ts`.

## Package calls behind the example

Server code imports neutral types from `@fantastic.dev/better-stripe/usage`; UI
code uses `@fantastic.dev/better-stripe/react`. The example backend lives under
`example/convex/meteredUsage`. Its atomic synthetic-work mutation follows this
pattern, using server-authorized original terms:

```ts
const reservation =
  model === "prepaid"
    ? await stripe.usage.reserveCredits(ctx, { event, subscription })
    : await stripe.usage.reserveAllowance(ctx, { event, subscription });
// Handle denied/released reservations before doing any application work.
const receipt = await stripe.usage.record(ctx, {
  event,
  subscription,
  reservationId: reservation.reservationId,
});
// Persist synthetic DB work and receipt in this same mutation transaction.
```

Schedule delivery from an action after the transaction commits:

```ts
await stripe.usage.startDelivery(ctx, {
  scope: original.scope,
  eventId: receipt.eventId,
  provider: internal.meteredUsage.delivery.deliver,
});
```

For external application work, use a durable idempotent work protocol with the
original business identity. A database transaction cannot make an external side
effect atomic. See [ledger](usage-ledger.md), [delivery](usage-delivery.md),
[limits](usage-limits.md), [corrections](usage-corrections.md) and
[settlement](usage-settlement.md) for the complete contracts.
