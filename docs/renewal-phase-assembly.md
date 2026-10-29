# Renewal phase assembly

The internal `renewalAggregate` module classifies an original subscription and
builds a bound two-phase configure candidate. It makes no provider call and is
not a public package entrypoint. It complements the public
[preparation contract](renewal-price-replacements.md) and internal
[preservation mappings](renewal-preservation-mappings.md).

This aggregate consumes V1 records. The public
[V2 attachment receipt constructor](renewal-context-reads.md#v2-attachment-receipt-consistency)
produces separate unsigned consistency data; it does not migrate records or
enable this projector to accept V2 receipts.

A candidate always has `providerQualification: "required"`. This describes a
remaining requirement, not authorization to dispatch. Host-supplied flags cannot
prove provider behavior, ownership, original configuration or historical intent.
The HTTP executor must reject unqualified required contexts before a write.

## Original-source preflight

`preflightRenewalReplacement` accepts:

```ts
{
  prepared,
  freshSubscription,
  targetPrice,
  billingCustomer,
  apiVersion,
  observedAt,
}
```

`prepared` is the privately retained `PreparedRenewalPriceReplacement`, including
its original snapshots and logical key. The function reconstructs that binding
instead of trusting its string. Source, target and correlated billing Customer
reads must agree with the retained snapshots. A missing retained billing Customer
is unsupported by this aggregate profile.

The host obtains fresh provider reads, authorizes the original buyer and target,
and retains consent and exclusive operation ownership. `observedAt` is a bounded
Unix timestamp within the original paid item period. It neither proves freshness
nor changes the expected renewal boundary. Use the actual configured
`BetterStripe.stripeApiVersion`; this profile supports `2026-09-30.endive` and
rejects an explicit preview version instead of silently replacing it.

Preflight checks exact customer account, customer, subscription, item, current
price/product, quantity, current period, target and currency. It rejects known
unsupported original cancellation, trial, pending, threshold, managed and special
billing state. Legacy source and explicit payment-setting restrictions from
preparation continue to apply. Valid product IDs may be custom nonblank IDs.

The paid-item profile requires an explicitly read `current_trial: null`. A
nonnull current or future item trial rejects even when the overall subscription
status is `active`. Missing item-trial evidence is unsupported, not replaced with
an invented null. Historical subscription trial fields remain in the snapshot.

Known financial settings are classified before attachment, including actual
subscription automatic tax and liability, collection method, invoice settings,
default payment method, routing and item settings. Invoice `days_until_due` is
read from the top-level Subscription field in Stripe 23, not from an invented
Subscription invoice-settings field. Available expanded payment-method customer,
account and mode facts must correlate with the original buyer.

Disabled automatic-tax reasons, unknown liability/collection/issuer enums,
malformed invoice settings, deleted routing references, invalid transfer
percentages and incompatible automatic/manual tax combinations reject at this
stage. A mapping that is knowably unsupported must not be deferred until after a
mutating attach. Fields available only on the acknowledged schedule are checked
later, without inventing a phase or acknowledgement during source preflight.

Success is `preflighted_for_projection`, with the exact selectors, quantity and
computed profile. Unsupported source settings return `unsupported`; observed
binding or source drift returns `conflict`. Success is not pending or effective.

## Acknowledged configure candidate

`projectRenewalConfiguration` takes the same source inputs plus:

```ts
{
  attachReceipt,
  schedule,
  configureKey,
  firstDispatchedAt,
}
```

The host retains an immutable attach request and its successful provider
acknowledgement. The attach request binds version, stage, platform scope, actual
API version, logical identity, POST path, exact `from_subscription` payload,
explicit key and retained first-dispatch time. Its receipt binds that request,
the exact acknowledged schedule, subscription, customer account and mode, and the
complete bounded provider schedule snapshot. These records are unsigned server
data, not signatures or a provider history service. A schedule found by GET or a
nonnull subscription association does not establish this operation's ownership.

Supply the actual post-attach subscription association. The aggregate validator
requires the exact acknowledged schedule ID and explicitly permits that known
transition from the retained original `schedule: null`. It does not replace a
fresh schedule field with null to reuse the preparation validator.

The fresh schedule must still match the complete acknowledged baseline and
defaults. It must be active, platform scoped, linked to the original buyer and
subscription, and contain the one expected current phase. Current schedule and
phase boundaries must agree with the retained paid item period. Unrelated future
phases, drift, cancellation/release state, active pause configuration and unknown
mapping fields reject. Unchanged defaults are validated even though the configure
payload leaves them untouched.

Effective collection method, automatic tax and invoice issuer are derived from
actual phase/default/subscription reads and checked against the already-qualified
original source context. Metadata actions must already match current original
subscription/item values. Flattened subscription metadata is not converted into
new phase actions.

An unsupported mapping discovered after a valid acknowledgement returns
`attached_unconfigured` with the owned schedule ID and reason. The host retains
the receipt. The SDK does not conceal the gap by releasing/canceling the schedule,
rolling back, using another subscription POST or claiming success. Receipt,
association and baseline drift remain conflicts.

## Tax values and override levels

This finite profile requires explicit tax-rate arrays on original subscription
and item reads and on acknowledged phase and item reads. Null or absent
hierarchies are unsupported, not converted into empty arrays. Such cases require
a separately established inheritance mapping before they can become eligible.

Ordered original subscription `default_tax_rates` IDs must match the current
phase's ordered default IDs. Ordered original item IDs must match the phase
item's IDs. An empty item array means no explicit item override, so the
subscription or phase default applies. The renderer uses the supported Emptyable
clear representation for an acknowledged explicit empty item array.

The comparison preserves override level as well as IDs. Introducing an item
override equal to current phase defaults is rejected, as is removing an original
item override while its current effective IDs happen to remain the same. Current
effective equality cannot authorize changing future inheritance behavior.
Automatic tax cannot coexist with nonempty manual phase or item rates.

## Phases, profile and request identity

The current phase keeps the provider's exact original start/end, original price,
quantity, currency, accepted settings and existing discount IDs. Its existing
known `proration_behavior` is preserved. Top-level update proration is `none`.
The future phase starts at that verified end, selects the exact target price and
same quantity, preserves accepted settings/redemptions, and has transition
proration `none`. It uses the target price's recurring interval/count as a
duration instead of a locally calculated future end date. End behavior is
`release`; defaults and arbitrary schedule metadata are not rewritten.

The computed profile records actual API version, known classic/flexible billing
mode, same/changed cadence and ordinary/calendar-edge anchor class. Cadence is the
exact interval and count, not an amount comparison or an assumed month/year
conversion. Same cadence uses automatic future anchoring; changed cadence uses
`phase_start` at the verified renewal only for the supported configuration class.
Changed cadence with an explicit anchor configuration is unsupported. Reapplying
a current `phase_start` anchor is rejected unless it agrees with the retained
numeric original anchor and current phase start.

Known monthly/yearly anchors on days 29–31 are classified as calendar edges.
Unknown modes/configurations, invalid numeric anchors and unqualified profiles
reject. Classification and synthetic dates do not prove month-end, leap-year,
invoice, proration, computed phase-end or release behavior on Stripe.

Success is `projected_configure_request`. Its complete normalized POST payload is
bound with stage, platform scope, actual API version, path, explicit configure
key, logical identity, full attach-receipt identity, full acknowledged baseline,
unchanged defaults fingerprint and retained first-dispatch time. The configure
key must differ from the attach key. Keys and times are not silently generated,
rotated or reset. Bindings and snapshots can contain private billing data; retain
them only on the trusted server, not in browser responses or logs.

The original item ID is bound for authorization. A future price transition is
not assumed to preserve that ID. Effectiveness requires an observer to correlate
the owned configured provider phase with the unique target successor item on the
original subscription. A POST acknowledgement, matching price, elapsed time,
clock advance, manual release or browser redirect alone is insufficient.

Provider qualification, single-attempt HTTP dispatch, retained-key lost-response
recovery and observation remain separate gates. Snapshot equality is not atomic
provider compare-and-swap; host serialization cannot exclude Dashboard or other
provider writers. Required consumer contexts outside this finite profile remain
open instead of being replaced by a provenance flag or hidden fallback.
