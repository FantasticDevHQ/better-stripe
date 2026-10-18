# Included usage and optional usage limits

BetterStripe supplies atomic quantity accounting for monthly included usage and
optional pay-as-you-go caps. Use native Stripe graduated prices for included
usage, provisioned by the [usage catalog](./usage-catalog.md), and enroll the
customer through [managed subscriptions](./usage-subscriptions.md). The free
first tier and original overage rate remain the billing terms. Limits control
access to work; they do not change the price or collect money.

Prepaid uses the separate [payment-backed credit APIs](./usage-credits.md).
`configureAllowance` rejects prepaid plans. No monetary wallet or extra usage
charge is created by allowance accounting.

## Configure before accepting usage

Authenticate and authorize policy management in a host mutation. Resolve the
payer, native customer, meter and original terms on the server. Do not accept
these identities or policy edits directly from an untrusted browser.

Use a binding returned by `stripe.usage.ensureSubscription`, `observeSubscription`
or `getSubscription`. Observe the current native subscription before initializing
a renewed period. A managed subscription must be active and its period must
still be open. This works with the supported managed collection methods.

```ts
const original = subscription.bindings[0];
await stripe.usage.configureAllowance(ctx, {
  ...original,
  expectedRevision: 0,
  policy: {
    entitled: true,
    reset: "billing_period",
    rollover: "none",
    overage: "allow",
    limit: { mode: "hard", quantity: "12000" },
  },
});
```

Configure every metered binding that needs limits. The plan supplies
`includedQuantity`, unit precision and the original decimal overage rate.
`limit.quantity` is total usage for the period, including free units, expressed as
an exact decimal string in that unit. A hard limit of 12000 with 10000 included
units permits 2000 billable overage units. `overage: "reject"` additionally caps
usage at the included quantity. The smaller hard cap wins.

`limit: { mode: "soft", quantity: "12000" }` reports a warning at the threshold
and continues accepting usage. `limit: { mode: "none" }` has no separate usage
threshold. `entitled: false` rejects new reservations. Pay-as-you-go supports
these optional total-usage thresholds with `overage: "allow"`; it has no free
included units. Prepaid insufficient-balance enforcement comes from paid grants.

This native v1 policy explicitly resets at the original monthly billing-period
boundary and has no rollover. Carrying free units or resetting on a calendar
month would disagree with the native price and is rejected. Change billing terms
at a verified future period, using the subscription lifecycle. Do not mutate an
existing period's free tier, price, currency, version or units.

Setup over existing unaccounted period usage is rejected. Reconcile that history
and enable the policy at the next verified period rather than granting a fresh
allowance over work already accepted. An overlapping period, new subscription or
changed binding cannot reset an existing counter. Once a native payer/meter or
logical scope has a policy, recording usage without a matching policy reservation
remains blocked at renewal until the next period is configured.

## Reserve before work, then commit with the ledger

Authorize the real activity in the host. Use its stable business identity for
`sourceEventId`, original occurrence time, and exact unit quantity. Reserve the
maximum quantity the work is allowed to perform. Commit that exact quantity;
changing it requires a new, explicitly authorized operation.

```ts
const event = {
  scope: original.scope,
  binding: original.binding,
  sourceEventId: activity.id,
  quantity: "5",
  occurredAt: activity.occurredAt,
};
const reservation = await stripe.usage.reserveAllowance(ctx, {
  event,
  subscription: original.subscription,
});
if (reservation.state === "denied") {
  return { allowed: false, reason: reservation.reason };
}
if (reservation.state === "released") {
  return { allowed: false, reason: "work_previously_released" };
}
if (reservation.state === "reserved") {
  // The worker must deduplicate real work using activity.id across retries.
  await performIdempotentWork(activity.id);
}
const receipt = await stripe.usage.record(ctx, {
  event,
  subscription: original.subscription,
  reservationId: reservation.reservationId,
});
```

Reserve and record must run from a context that supports component mutations.
External work belongs in an action or durable worker. A query used to render a
button never grants permission to run work. Concurrent reservations update the
same counter transactionally, and hard-cap decisions include both consumed and
reserved units. Ledger acceptance commits the reservation, immutable event and
outbox in one transaction. A failed transaction rolls all of them back.

Exact reservation and record retries return their prior result. Changed quantity,
price, subscription, occurrence time or source identity conflicts. A committed
reservation must not run work again. A released reservation stays released.
Historical source identities remain reserved across periods and subscriptions.

A timeout or unknown worker result retains reserved capacity. Confirm work did
not happen before releasing it. There is no automatic lease expiry that could
admit a second job while the original job still runs.

```ts
await stripe.usage.releaseAllowance(ctx, {
  scope: original.scope,
  reservationId: reservation.reservationId,
  reason: "work_failed", // or "abandoned_before_work"
});
```

Release retries with the same reason are idempotent. A different reason conflicts.
Committed usage cannot be released. Delivery rejection, uncertainty, delayed
native aggregates or an unpaid invoice do not restore allowance. Corrections
retain the original event and terms and require an auditable correction outcome;
never decrement counters based on an invoice preview or an optimistic UI action.
See the [auditable correction workflow](./usage-corrections.md).

## Edit access policy without resetting consumption

Read `getAllowanceStatus` and pass its `revision` as `expectedRevision` when changing
limits or entitlement. An exact policy replay returns the current revision;
a different policy with a stale revision fails. Cap and entitlement changes keep
all consumed and reserved units. Lowering a cap below those units denies new work.
Already reserved work retains its original authorization and can commit once,
even after entitlement is disabled or the cap is lowered. To cancel that work,
stop the worker and explicitly release its uncommitted reservation.

```ts
const status = await stripe.usage.getAllowanceStatus(ctx, original);
if (status) {
  await stripe.usage.configureAllowance(ctx, {
    ...original,
    expectedRevision: status.revision,
    policy: { ...status.policy, entitled: false },
  });
}
```

A new verified billing period gets a new counter. Historical counters and
reservations remain readable. A late reservation from a closing or old period
cannot become current-period usage. New acceptance closes 60 seconds before the
native period ends, matching the managed delivery lifecycle.

## Read status, evidence and reconciliation

`getAllowanceStatus(ctx, original)` returns `null` for an unavailable exact binding.
Otherwise it returns revision, observation time, period, policy, consumed and
reserved quantities, free units remaining after reservations, committed billable
overage, soft-limit state and remaining hard-cap capacity. `accepting` also
checks the current stored managed enrollment and closes on retirement or expiry.
It is a display observation; only a successful atomic reservation permits work.
Refresh the managed subscription through its native observation API when provider
state changes. A cached database view cannot prove a newly changed native state.

`committedEstimate` prices only committed usage. `projectedEstimate` also includes
reservations. Both use the original rate and exact decimal minor currency units.
They exclude fixed fees, tax, discounts and payment collection. The result always
reports `cashCollection: "none"`. Do not render estimates as available money,
paid invoices or seller/affiliate earnings.

```ts
const local = await stripe.usage.reconcileAllowance(ctx, original);
const page = await stripe.usage.readAllowanceHistory(ctx, {
  ...original,
  limit: 25,
  cursor: null,
});
```

The history reader pages immutable policy, reservation, commit and release evidence
for the exact binding. Limits are 1–100 rows, with a returned cursor. Evidence is
retained, with a quota of 100000 history records per period. Accounting mutations
fail atomically when that retained quota is exhausted.

`reconcileAllowance` compares the counter with immutable accepted events and open
reservations. It returns `matched` only with complete matching local evidence.
The read is bounded to 500 events and 500 open reservations; larger or conflicting
histories return `held`, never a false match. It does not repair or restore units.
Stop new work and investigate a held result through the paged ledger/history
readers. Native quantity/invoice comparison remains available through
`getReconciliation`, `getProviderUsage` and `readInvoiceUsage`; those observations do
not enforce or reset access caps. A native invoice's payment status cannot prove
new cash collection on its own.

## Developer and agent setup checklist

1. Use an ordinary Stripe test sandbox. No Metronome account or token is needed.
2. Follow [sandbox setup](./metering-setup.md), then provision the native catalog
   and managed subscription with the package APIs. Keep secret keys server-side.
3. Select the included plan or an optional pay-as-you-go limit. Choose explicit
   entitlement, reset, no-rollover, overage and hard/soft threshold policy.
4. Configure each current binding before accepting usage. Observe native renewal,
   then initialize the next period before running more work.
5. Authorize activities, reserve, perform idempotent work and record the same
   original event. Start the existing durable delivery workflow for its outbox.
6. Expose scoped status/history queries and authorized policy commands. Handle
   denied, released, committed and unknown work states explicitly.
7. Test competing last-capacity requests, replay, failed work, policy revision
   conflicts, renewal and stale UI. Compare accounting and native observations
   without turning lag into permission to grant additional units.

Native pricing reference: [Stripe usage-based pricing models](https://docs.stripe.com/billing/subscriptions/usage-based/pricing-models).
