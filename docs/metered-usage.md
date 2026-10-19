# Native Stripe metered billing

BetterStripe supports pay as you go, included monthly units with overages, and
paid prepaid credits through native Stripe Billing Meters, subscriptions and
Billing Credit Grants. The public package owns durable usage, delivery, allowance
and credit accounting, corrections, original-payment settlement and reusable React
workflows. Hosts own authentication, billable business activity and billing policy.

Start with [native setup](metering-setup.md), run the
[three example flows](usage-example.md), then use the
[verification matrix](usage-verification.md). For an existing application, follow
[opt-in adoption and rollback](usage-rollout.md). Metronome is optional; it is not a
credential, dependency or prerequisite for this integration. No Metronome adapter
is included.

## Choose a model and define units

| Model              | Customer behavior                                                       | Package accounting                                                                                        |
| ------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `pay_as_you_go`    | Pays for effective usage on the subscription invoice                    | Immutable usage plus optional entitlement/cap reservations                                                |
| `included_overage` | Gets included units each verified monthly period, then pays for overage | Atomic included/overage reservations, hard or soft limits, separate period counters                       |
| `prepaid`          | Buys units before consumption                                           | Verified original payment and price-scoped grant, atomic reservation/consumption, exhaustion and recovery |

Developers choose the unit, precision, price and policy. This example uses whole
requests at USD 1 per request. Rates are decimal strings of **minor currency
units per whole billable unit**, so USD `"100"` means USD 1, not USD 100.

```ts
import { defineUsagePlan } from "@fantastic.dev/better-stripe/usage";
const common = {
  key: "requests",
  version: "v1",
  unit: { name: "request", precision: 0 },
  rate: { currency: "usd", unitAmountDecimal: "100" },
} as const;
const payAsYouGo = defineUsagePlan({ ...common, model: "pay_as_you_go" });
const included = defineUsagePlan({
  ...common,
  model: "included_overage",
  includedQuantity: "10",
  reset: "billing_period",
});
const prepaid = defineUsagePlan({
  ...common,
  model: "prepaid",
  insufficientBalance: "reject",
});
```

Select one plan for an original binding. Do not submit one activity to all three
alternatives. Configuration validates terms; it does not provision resources,
authorize a caller or fund credits. Use a new version, event name and price lookup
key for changed terms. Preserve old prices and original activity bindings.

## Provision the original binding

In an authenticated host action, authorize the issuer realm, product and Accounts
v2 payer. Resolve the payer's provider-owned mapped `cus_` identity; do not create
an unrelated Customer to hide a mapping error.

```ts
const meter = await stripe.ensureUsageMeter(ctx, {
  scope: { stripeAccountId: issuerId, livemode: false },
  plan: selectedPlan,
  eventName: "requests_v1",
  displayName: "Requests v1",
});
const price = await stripe.ensureUsagePrice(ctx, {
  scope: { stripeAccountId: issuerId, livemode: false },
  plan: selectedPlan,
  meterId: meter.id,
  stripeProductId: authorizedProductId,
  lookupKey: "requests_v1_usd",
});
const enrollment = await stripe.usage.ensureSubscription(
  ctx,
  {
    requestId: originalSignupId,
    meters: [
      {
        scope: {
          stripeAccountId: issuerId,
          customerAccount: payerId,
          meterId: meter.id,
          livemode: false,
        },
        binding: {
          stripeCustomerId: mappedCustomerId,
          stripePriceId: price.stripePriceId,
          eventName: meter.event_name,
          plan: selectedPlan,
        },
      },
    ],
    fixedPriceIds: [],
    collection: { method: "send_invoice", daysUntilDue: 30 },
  },
  { stripeSecretKey },
);
```

Persist and reuse the verified `enrollment.bindings` and original signup identity.
Read native status and period before admitting work. See
[catalog](usage-catalog.md) and [subscriptions](usage-subscriptions.md) for Checkout,
automatic collection, supported native shapes and bounded recovery.

## Admit work through the component

For pay as you go and included usage, configure the original verified period with
`configureAllowance`. Choose entitlement, `overage`, and a `none`, `soft` or `hard`
limit. `reserveAllowance` enforces that policy before work; included units and
billable overage derive from the immutable plan. See [limits](usage-limits.md).

For prepaid, call `purchaseCredits` with a stable business purchase ID and the
original credit binding. Send its `clientSecret` only to the authenticated
purchaser's payment UI. After payment, call `observeCreditPurchase`; only its
verified ready grant makes units spendable. `reserveCredits` rejects insufficient
or unreconciled backing. Consumption never creates another cash charge. See
[paid credits](usage-credits.md). Credits cover the issuer's own services, not a
third-party seller wallet or reseller redemption.

The host resolves the immutable business activity and authorizes it before this
shared mutation pattern:

```ts
const receipt = await authorizeUsageRecord(
  ctx,
  policy,
  serverEvent,
  async (event) => {
    const reservation =
      event.binding.plan.model === "prepaid"
        ? await stripe.usage.reserveCredits(ctx, { event, subscription })
        : await stripe.usage.reserveAllowance(ctx, { event, subscription });
    if (reservation.state === "denied" || reservation.state === "released")
      throw new Error("Usage is not admitted");
    const receipt = await stripe.usage.record(ctx, {
      event,
      subscription,
      reservationId: reservation.reservationId,
    });
    await applyDatabaseWorkOnce(ctx, originalActivityId, receipt);
    return receipt;
  },
);
```

Import `authorizeUsageRecord` from the `/usage` entry point. `policy`,
`serverEvent`, `subscription` and `applyDatabaseWorkOnce` are authenticated host
adapters. The business adapter must read a completion marker keyed by the
original business activity and apply work once in this same Convex transaction.
Usage replay alone does not make arbitrary application work idempotent. Keep the
original reservation reference for completed work; do not re-reserve new capacity
under another ID after closing its account. External effects require a durable,
idempotent work protocol rather than a database-only transaction.

Recording atomically commits usage, reservation consumption and an outbox. It
performs no provider I/O. Schedule `usage.startDelivery` after commit, or provide
its supported transactional dispatch handle. The host's internal provider action
uses `usageDeliveryArgs` / `usageDeliveryResult` and delegates to `usage.deliver`
with execution-time credentials. See [ledger](usage-ledger.md),
[delivery and callbacks](usage-delivery.md), and [authorization](usage-security.md).

## Read, display and settle

Use `getSummary` for bounded local totals, `observeProviderUsage` / `reconcile` for
native aggregation, and `readInvoiceUsage` for original invoice lines. A delivery
receipt is not aggregation or payment. A preview or estimate is not a finalized
invoice. Missing, stale, partial or unknown evidence remains unavailable or held.

The `/react` entry point supplies `UsageConfiguration`, `UsagePriceRow`,
`UsageBilling`, `UsageSummary`, `UsageAllowance`, `UsageCredits` and paginated
`UsageHistory`. Bind them to authenticated host readers; browser view keys are
cache identities, not authorization. Server types also have neutral exports from
`/usage`. See [React views](usage-react.md) and
[configuration UI](usage-configuration.md).

For pay as you go and included overage, `getInvoiceSale` verifies original paid
proceeds before `settleInvoice`. For prepaid, use `getCreditPurchaseRevenue` and
`settleCreditPurchase` on the original purchase. A zero-dollar usage invoice must
not create another sale or affiliate commission. Actual processing fees,
recipient eligibility, refunds and disputes retain their original sources. See
[settlement](usage-settlement.md) and [corrections](usage-corrections.md).

## Precision, windows and retained limits

Quantities are canonical decimal strings with 0–6 fractional digits and at most
18 scaled integer digits. Never round or pass JS floating-point quantities. Native
catalog/credit adapters apply tighter bounds where required. Occurrence time is
original business time in Unix seconds, within the immutable half-open period and
Stripe's 35-day past / five-minute future window. Retrying does not change time.

Provider aggregation is asynchronous. Unknown sends cannot be blindly retried,
even inside provider deduplication windows. Native creation recovery stops blind
writes after 23 hours. Correction, cancellation and late invoice-adjustment
windows are separately documented in [corrections](usage-corrections.md).

Local retained-event quotas are bounded at 100,000 per scope; read pages contain
1–100 rows. Other audit, purchase and native-proof bounds have explicit held/error
states in their domain guides. There is no financial-history deletion/reset API.
Keep original IDs, prices, API/definition versions and worker handlers available
while operations can resume. Follow [rollout and recovery](usage-rollout.md).

The [verification matrix](usage-verification.md) records exact tested account
modes, actual fees and transfer proof, future-test-clock limits, injected failures
and unverified live-money/throughput cases. Historical feasibility probes remain
in the repository; they do not replace the package's ledger or paid-source proof.
