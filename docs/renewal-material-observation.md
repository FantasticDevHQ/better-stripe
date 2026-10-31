# Compare renewal schedule material

`inspectRenewalScheduleMaterialV2` compares supplied, complete subscription and
schedule reads against a raw V2 renewal configuration. It performs no provider
calls, writes, scheduling, authorization or trusted-store verification. Its result
is an unsigned material relation, not proof of a configure POST, payment,
entitlement, consent, exclusive causality or an atomic exclusion of other writers.

```ts
import {
  inspectRenewalScheduleMaterialV2,
  type InspectRenewalScheduleMaterialV2Options,
} from "@fantastic.dev/better-stripe";

const input: InspectRenewalScheduleMaterialV2Options = {
  configuration: retainedRawConfiguration,
  reads: {
    schedule: currentOwnedSchedule,
    subscription: currentOriginalSubscription,
    targetPrice: currentTargetPrice,
    billingCustomer: currentBillingCustomer,
    coupons: completeCurrentCoupons,
  },
  // Optional complete raw input to constructRenewalConfigurationReceiptV2.
  configureReceipt: retainedRawConfigurationResponse,
};
const relation = await inspectRenewalScheduleMaterialV2(input);
```

`configuration` is the full raw input accepted by
[`projectRenewalConfigurationV2`](renewal-phase-assembly.md), including the original
preparation, raw attachment receipt input, fresh preconfigure reads, observed time,
retained dispatch time and caller-owned key. The observer rebuilds the preparation,
attachment and desired request internally. It does not accept a caller-validated
context, desired-request handle or an authenticated-receipt flag.

The optional `configureReceipt` is the complete raw input to
`constructRenewalConfigurationReceiptV2`. Its nested `configuration` must equal the
root configuration, including optional-field presence. The observer rebuilds the
receipt and classifies its complete historical response before comparing current
reads. This binds supplied data consistently; it does not authenticate who returned
or stored that response. Supplying it never changes
`acknowledgementEstablished: false` or `authenticationEstablished: false`.

## Results and complete material

Every result has `providerQualificationRequired: true`. The `predicate` is one of:

| Predicate                       | Meaning                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `attached_unconfigured_match`   | The complete attached single-phase material still matches.                                                               |
| `pending_material_match`        | Current paid material and the exact future phase match, with a supported independently bound future end.                 |
| `current_target_material_match` | The target phase is current and the uniquely identified target item, native period and complete retained material match. |
| `terminal_facts_only`           | A terminal status was supplied; effectiveness remains `unknown`.                                                         |
| `unknown`                       | Required evidence or a supported mapping is missing.                                                                     |
| `conflict`                      | Supplied material contradicts the retained operation.                                                                    |

A current target match can identify a successor subscription item. It does not
require the original `si_` ID to survive the schedule transition. It requires the
linked original subscription and buyer, exact phase and native item period,
price/product, quantity, currency, full Price/Plan mapping, settings, discounts,
taxes, customer material and supported expanded-reference counterparts. Matching
only a price or future phase is insufficient. Unknown retained fields and counters
remain comparison material; they are not silently dropped or incremented.

### Invoice-pointer limitation

This API accepts five current-read categories. It has no invoice inventory, full
invoice/line history or owned successor-invoice proof. Both the original and current
subscription must contain their own `latest_invoice` field. An original `I0` and
current `I1` produce `conflict` with `effective_full_material_drift` when the other
active-material checks pass. This can describe a normal renewal that this limited
comparison cannot prove. Omitting the field does not make it supported; missing
fields produce `unknown` with `missing_latest_invoice`.

A positive active-material example therefore requires coherent invoice pointers
under the existing complete comparison. It does not prove that real renewals keep
that pointer unchanged. An optional raw configure receipt does not authorize an
`I0` to `I1` change. Admitting such changes requires separately defined owned
invoice-history evidence. This helper is not the complete renewal-observation or
renewal-replacement workflow.

### Pending without a configure response

A complete current-target match can be established from supplied reads without a
configure response. A pending match without that response has a narrower supported
class: classic billing, changed cadence, an ordinary anchor, a one-week licensed
target with explicit `phase_start`, and no trial, threshold, cancellation, pause or
other supported period-resetting condition. Every complete current-paid and future
settings guard must still pass.

For this class the observer infers the future end as the retained boundary plus
604800 UTC seconds, with safe-integer checks, then compares the actual future end.
This is a bounded consistency inference from Stripe's
[phase duration](https://docs.stripe.com/billing/subscriptions/subscription-schedules)
and [UTC billing-anchor](https://docs.stripe.com/billing/subscriptions/billing-cycle)
contracts. It is not a provider-qualified observation of the exact calculation.
No host calendar, invoice calculation or caller-supplied expected end is used.

Monthly/yearly, multi-week, flexible, automatic-anchor, calendar-edge and other
unproved future durations remain `unknown` with `future_duration_not_bound` unless
the complete historical raw configuration response binds the end under the
supported comparison rules. Reads never become a configure POST acknowledgement.
Released, canceled and completed facts do not establish terminal effectiveness.
A supplied schedule status must be a string. Arrays, objects, null and numeric
statuses return `unknown` with `invalid_schedule_status`; an unrecognized string
keeps `unknown` with `unsupported_schedule_status`. Values are never coerced into
a known terminal status.

## Capture and limits

The entire input is captured synchronously before asynchronous binding work.
Later caller mutations do not change that invocation. Roots must be plain or
null-prototype objects with closed own data fields. Getters, symbols, hidden
properties, sparse arrays, non-finite values and non-JSON objects are rejected;
SDK `lastResponse` metadata is not stripped from untrusted bare response inputs.

The whole submitted input, including repeated raw configuration material, is
limited to 500000 string/key characters, serialized characters and UTF-8 bytes,
10000 nodes and depth 40. These are this API's actual input bounds, not a claim
about whole-process memory or other SDK methods. Invalid raw capture rejects with
a fixed error; safe but insufficient material returns `unknown` or `conflict`
with a fixed reason. No raw provider error is logged or returned. The host remains
responsible for retaining its immutable request and response data when reads fail.

## Internal owned observation and retained configure acknowledgements

`captureOwnedRenewalObservationV2` is internal; each captured handle permits one
invocation. Its fixed Source must bind the original Owner and origin, original
attachment entry and actual acknowledged attachment receipt identity to a distinct
observation entry. Reconstructing equal receipt data cannot establish that
association. The normal registry is empty and its loader unbound. There is no
public execution export or caller-supplied Owner, client or Source context.

After bounded record capture, the original configuration projection runs first.
A supported Failure returns the same object before the actor's explicit receipt
proof, classification or reads. Success requires the complete retained record and
attachment proof, original entry coverage and a live original Owner.

The read order is Schedule, expanded Subscription, target Price, billing Customer,
then unique Coupon IDs across the original and current subscription and item
discounts. Two distinct Coupon IDs give six GETs; the union permits at most 40
Coupons and 44 GETs. Complete bare response bodies and ordinary unknown fields are
retained. This invocation makes no POST and appends no C10 events. When both
configure fields are absent, it calls no configure-receipt constructor. The
optional branch reconstructs the retained receipt before current reads.

`owned_observation_data` contains `observation`, `reads`, the final read's
`observedAt`, `retainedConfigureAcknowledgement: "absent" | "present"` and
`operationalAuthority: false`. The complete pure-helper result is preserved.
Record, observer input and result each remain within 500000 serialized characters
and UTF-8 bytes, 10000 nodes counting repeated occurrences, and depth 40. The
result is detached and frozen before its final Owner check. Owner checks guard
settled continuations; they do not promise immediate cancellation of pending HTTP.

The fixed Source can omit both `configureAcknowledgement` and
`configureOperation`, or supply both. Supplying only one rejects before the
original projection. With both present, a supported original projection Failure
still returns unchanged before configure custody checks or reads.

The optional branch requires the actual configure operation and the exact
acknowledgement wrapper returned by its writer under the same original Owner, origin, attachment
entry and complete retained record. An equal reconstructed object does not
establish custody. A valid receipt that was constructed but never returned does
not satisfy this relation. The lookup exposes detached frozen data, including
the complete original receipt-constructor input, without exposing private history
or transport capabilities. The observer constructs a fresh receipt from that
input and checks the entire acknowledgement, including default-setting presence,
before acquiring current reads. It supplies the full retained input to the
unchanged public pure helper as `configureReceipt`.

The `present` marker describes this process-local returned-receipt association.
It does not establish durable custody after restart, provider qualification,
pending or effective state. A retained one-phase response can still produce an
honest `unknown` result. With complete configured historical material, the branch
preserves the pure helper's `pending_material_match` or
`current_target_material_match` comparisons. Those results remain unsigned
material predicates. The absent branch keeps the helper's existing
pending/effective classes and invoice-pointer limitation. Historical and terminal
provider qualification, successor invoice evidence and genuine Source binding
remain separate requirements. These sequential reads do not atomically exclude other provider
writers or establish payment, authentication or entitlement.

## Private evidence analyzer development

The private version 1 evidence interface separates schedule lifecycle facts,
current material, historical snapshot consistency and invoice correlation. Its
`apiVersion` names the analyzer's supported `2026-09-30.endive` profile. It does
not authenticate the supplied resource bodies.

The private analyzer admits the complete bounded input and reconstructs the
original V2 configuration before reporting owned lifecycle facts. Canceled and
released facts do not imply natural completion. Completion requires the complete
owned phase history and defaults, a valid terminal timestamp and a proven target
end. Supplied configure receipts are reconstructed and checked against the
complete original configuration and the maintained full historical baseline.
That baseline alone can agree on an arbitrary future end, so this profile also
requires the existing narrow UTC weekly requested-duration predicate. Unproven
calendar-duration profiles remain `unknown`; no month arithmetic is invented.
The same weekly predicate remains required when the configure receipt is null.
It has no public SDK export or provider transport. Existing observation methods
retain their documented behavior.

The input keeps complete raw resources and distinguishes absent fields from
own `null` values. Current material reuses the maintained full attached, pending
and active comparison, including settings, unique item identity and native
period. If `latest_invoice` advances, the analyzer first recomputes the complete
paired invoice proof. Only then may a separate comparison copy replace that
single pointer with its retained original value; the actual input, original C1
source and all request hashes remain unchanged. Full material drift still
refuses a match. A valid billing line alone cannot establish full effectiveness.

Invoice correlation uses the pinned Endive parent/pricing paths, the original
Subscription and its actual item identities, and exact native `(start, end)`
pairs. The retained original and fresh current invoice pointers must name distinct
invoice IDs. Supplying two period-specific inventories under one invoice ID
cannot establish paired renewal invoice evidence, including with expanded
pointers. Original invoice reasons are `subscription_create` or `subscription_cycle`;
renewal reason is `subscription_cycle`. The first profile checks every supplied
page, at most two pages of 100 rows, and requires one eligible line. Incomplete,
duplicate or nonprogressing inventories remain unknown. Decimal strings are
compared exactly without floating-point conversion and retain their wire text.
No `end - 1` or calendar approximation is applied. Invoice status, including
`paid`, provides no payment, settlement, entitlement or exclusive-cause authority.

A supplied historical snapshot is checked as complete unsigned material for the
same original operation. It can match while live terminal or settings data
conflicts; the axes remain separate. Terminal-only reads do not stand in for a
full historical active snapshot. These comparisons do not prove that a snapshot
was observed at an actual past time or supply a durable acquisition channel.

The analyzer is private and performs no provider calls. Existing public and
owned observation methods retain their output layouts and read profile. Actual
Endive provider qualification, historical acquisition and operational Source
binding remain separate requirements.
