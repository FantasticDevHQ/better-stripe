# Exact price replacement at renewal

`prepareRenewalPriceReplacement` is a pure server-side preparation contract. It
qualifies supplied provider reads and binds the original and target. It performs
no reads, writes, authorization, scheduling or reconciliation. A `prepared` result
is **not** permission to write, a pending price change or an effective change.
Its `preservation: "requires_schedule_validation"` field makes that distinction
explicit. Schedule execution is not supplied by this preparation helper.

Use this contract for one original platform-owned subscription with an Accounts v2
customer account and one complete, licensed recurring item. The selected target
can belong to another product. The host authorizes the original buyer,
subscription and target, decides upgrade/downgrade direction and timing, and keeps
consent and durable dispatch claims. An `acct_` customer account does not imply a
`Stripe-Account` request header. This contract does not select a connected scope.

```ts
import { prepareRenewalPriceReplacement } from "@fantastic.dev/better-stripe";

// Trusted server reads, including an expanded original item price.
// Authorize these selectors and the operation before obtaining provider reads.
const prepared = prepareRenewalPriceReplacement({
  subscription: retrievedOriginalSubscription,
  targetPrice: retrievedApprovedTargetPrice,
  expected: authorizedOriginalAndTarget,
  key: retainedLogicalOperationKey,
});
// Persist privately with immutable consent and original authorization.
// No schedule has been created by this call.
await hostOperationStore.savePrepared(prepared);
```

`expected` includes `customerAccountId`, `subscriptionId`, `itemId`,
`currentPriceId`, `currentProductId`, `targetPriceId`, `targetProductId`,
`periodStart`, `periodEnd` and `livemode`. Current period timestamps come from the
original **item** in Stripe 23, not a top-level subscription period field. The
helper checks every selector against the reads. It preserves quantity and binds
complete JSON provider snapshots, including fields that later schedule validation
must classify. The original price remains unchanged. Archived original prices may
remain valid paid terms; the target must be active and different, in the original
currency. Different products and recurring cadences are represented without
inventing tier ordering or financial arithmetic. Representation does not certify
that a future writer supports every cadence, billing mode or setting.

Product IDs may be provider-valid custom nonblank IDs, as well as generated
`prod_` IDs. Original and target product selectors must still match exactly.
The internal [preservation mappings](renewal-preservation-mappings.md) document
field projection boundaries separately from complete schedule eligibility.

The subscription's actual `currency` must match both prices' default `currency`.
This helper does not select `currency_options` or infer an alternative amount.
Alternative-currency contexts need a separate explicit mapping and are rejected
here rather than accepted because the two default price currencies happen to match.

An optional `billingCustomer` input adds an authoritative ancestor billing read.
Stripe documents that `customer_account` responses also identify a v1 `customer`,
and that customer-configured accounts can be retrieved through the v1 Customers
endpoint. See [the customer-account bridge](https://docs.stripe.com/accounts-v2/use-accounts-as-customers#reference-accounts-in-customers-v1-integrations).
Supply the full undeleted Customer with an explicitly read, expanded `discount`
field. The helper checks its `cus_` ID against the subscription's `customer`, its
`customer_account` against the authorized `acct_` selector, and its `livemode`.
Its complete JSON joins the private canonical snapshot. Missing discount evidence
is rejected when a billing customer is supplied; omitted ancestor evidence leaves
preparation incomplete for any writer that needs it.

An explicit ancestor `discount: null` proves only the observed absence of that
discount. It does not distinguish historical phase discount suppression from
inheritance, and does not authorize freezing or suppressing future customer
discounts. That unresolved distinction remains a schedule-validation boundary.

The helper requires an active, renewing, single-item original. Unrelated attached
schedules, cancellation intent, paused collection, pending updates, explicit legacy
payment sources, custom payment settings and nonnull application fees are rejected
at this pre-attach boundary. Explicitly disabled default payment settings are
accepted as a snapshot, not as proof of retained provider semantics. Historical
trial timestamps are retained; active trials are outside this boundary. Unknown
or unsupported execution settings must be rejected before a write, even if their
JSON was valid during preparation.

## Identity and ownership

The required caller key must be nonblank, at most 255 characters and contain no
line breaks. `requestIdentity.binding` is an opaque versioned canonical snapshot,
not a signature, authorization token, reservation or historical lookup. Object key
order does not change it; source or target changes do. Keep the complete prepared
operation immutable. The SDK has no historical binding store. An authorized host
could construct another binding for the same key; doing so is not safe replay.

Full snapshots and bindings can contain private provider metadata and customer
data. Store them on the trusted server. Do not expose them to the browser, logs or
PR evidence. Return only the necessary display summary and an authorized host
operation reference to the UI. The helper copies bounded finite plain JSON and
rejects executable, cyclic or excessively large inputs.

Preparation describes observed data. It does not establish that a read is fresh,
that the provider returned it, or that the host authenticated its owner. Re-read
and compare material state immediately before dispatch. A read fingerprint is not
an atomic compare-and-swap token. Host serialization cannot exclude independent
Dashboard or other provider writers; detected drift must remain a conflict.

## Required execution protocol

Stripe documents two distinct writes: create with `from_subscription`, then update
the resulting schedule with the unchanged current phase and future target phase.
Omitted phase settings can be unset. See [Stripe's subscription schedule guide](https://docs.stripe.com/billing/subscriptions/subscription-schedules#changing-subscriptions).
The Portal's own period-end downgrade is limited to same-product prices, as
documented in [Portal configuration](https://docs.stripe.com/customer-management/configure-portal).

The following is the required protocol for subsequent execution work, not a set
of methods implemented by this preparation helper:

| Stage     | Required evidence and result                                                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prepare   | Authorized exact original/target/period and immutable private snapshots. No mutation.                                                                                                                               |
| Attach    | One explicit creation POST with the retained attach-stage key and exact normalized payload. Return and durably retain the acknowledged original schedule receipt. Attachment alone is incomplete.                   |
| Configure | Use that acknowledged receipt, fresh validated reads and a separately retained configure-stage key bound to the complete update. One explicit update POST. No implicit attachment.                                  |
| Observe   | Read the known owned schedule and original subscription. Confirm the exact target/boundary/settings before reporting pending. Require provider current subscription/item/price identity before reporting effective. |

Every future stage record must include its version, logical preparation binding,
actual configured Stripe API version, explicit platform scope and complete
normalized payload. The attach payload is exactly
`{ from_subscription: expected.subscriptionId }`, with no inline phase or metadata
options. Attach and configure use distinct explicitly supplied provider keys;
neither key is silently generated from the logical key. Each stage binding covers
the stage, logical binding, API version, scope and payload. Configure additionally
binds the acknowledged schedule ID, complete acknowledged baseline and unchanged
schedule-default fingerprint, not just the attach request's identity.

The trusted host durably retains the original first-dispatch time with each
immutable stage request. Replay must retain it, not start another retention clock.
An acknowledged receipt retains that exact request, original subscription/account,
schedule ID, livemode and full acknowledged provider response. These are unsigned
server-owned records, not browser-supplied provenance or a second business ledger.

The original item ID authorizes the prewrite request. Stripe's phase update shape
accepts price and quantity without an item-ID selector, so a transition is not
assumed to retain the same `si_` ID. A future observer must correlate any successor
item through the retained owned schedule's exact target phase and original
subscription/account. Matching target price alone is insufficient. Manual release
or ambiguous completion must stay unknown until authoritative completion
correlation is available; no wall-clock fallback is allowed.

Each invocation permits at most one **mutating POST**, with automatic transport
retries disabled for its reads and write. It must not chain attachment and
configuration, rotate keys, fall back to unkeyed creation, or cancel/release a
partial schedule as hidden rollback. The host explicitly invokes each stage and
persists its identity before dispatch and its acknowledged receipt afterward.

A lost attach response is unknown. A nonnull `subscription.schedule` must neither
prove ownership nor automatically prevent explicit same-key recovery of the
original acknowledged response. Matching shape alone never authorizes adopting a
schedule. Retained provider idempotency can recover an acknowledged receipt only
under its documented rules. [Keys can be pruned after at least 24 hours](https://docs.stripe.com/api/idempotent_requests);
there is no permanent replay guarantee. Do not silently reissue after retention.

After an unknown configuration result, exact reads of the retained owned schedule
can confirm pending, conflict or uncertainty. A failed observation must not erase
an already acknowledged receipt or invent success. Keep attached-unconfigured,
unknown, confirmed pending, effective, canceled and released states distinct.
Wall time, a future phase or a browser return alone never proves effectiveness,
payment, entitlement or commission eligibility.

## Preservation matrix and implementation gate

This table is the mapping contract for the next write slices. A representable
field is not proof of a lossless provider transition. The configure mapper must
resolve every applicable row before the first mutation; no response-object spread
or extra `subscriptions.update` workaround is permitted.

| Original setting                    | Required mapping or explicit unsupported boundary                                                                                                                                                                                                                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Item and period                     | Verify complete single-item identity, expanded original price/product, quantity and item period. Keep current start/end and paid item unchanged; bind the target to that exact end. Metered/tiered or missing quantities need a separate supported contract.                                                                |
| Null and inheritance                | Preserve the distinction between schedule defaults, phase overrides and customer fallback. Extract expanded IDs. Send empty-string clears only for fields declared `Emptyable`; never universally turn null into omission, zero or an empty string.                                                                         |
| Discounts                           | Preserve existing discount IDs, order, duration and item/subscription precedence. Omission may inherit customer discounts; an explicit empty-string list suppresses inheritance. Re-redeeming a coupon can restart duration. Establish target-product eligibility and provenance before supporting a discounted transition. |
| Tax                                 | Project only writable enabled/liability values and tax-rate IDs at their original level. Do not copy read-only disabled reasons. Preserve manual versus automatic mode and liability scope; unresolved combinations reject.                                                                                                 |
| Trial                               | Retain historical dates. Active/future trials need an exact phase timeline plus proof of retained `trial_settings`. Never force `trial_end: now`, add a free phase or blindly resend past timestamps.                                                                                                                       |
| Cancellation                        | `cancel_at` and `cancel_at_period_end` have no direct phase equivalents. Reject cancellation intent until an exact supported mapping exists. `end_behavior` is not a substitute, and must not clear the original intent.                                                                                                    |
| Payment method                      | Normalize an expanded method to its ID at the same defaults/phase level. Null may mean fallback and is not a writable clear in every location. Do not freeze a customer default into a new explicit override.                                                                                                               |
| Legacy sources and payment settings | No direct phase/default write for `default_source` or `payment_settings`. Absence of a write field does not prove Stripe loses the subscription value. Explicit nondefault cases need retained-field proof or fail before attachment; never translate a legacy source to a payment-method ID.                               |
| Application fee                     | Phase/default fee writes have a connected-account prerequisite. Nonnull fee, including zero, is outside this platform contract until ownership and retention are qualified. Do not add a connected header or silently drop the fee.                                                                                         |
| Routing                             | `transfer_data` and `on_behalf_of` are separate from fee ownership. Preserve destination/account IDs and exact percentage/omission semantics where supported. Do not infer zero/full transfer or compute financial splits.                                                                                                  |
| Invoice/collection                  | Preserve collection mode, due-day semantics, issuer/tax IDs and supported custom invoice fields at their original level. Auto-charge null days are not a writable null. Unknown issuer values and unsupported clear/inheritance cases reject.                                                                               |
| Anchor, billing mode and thresholds | A numeric subscription anchor cannot be copied into a phase enum. Prove unchanged current boundary and target-cadence behavior. Preserve migrated billing mode; map thresholds only when their effect on renewal is supported. No automatic anchor reset.                                                                   |
| Metadata and extra invoice items    | Retain reserved and host metadata without turning subscription metadata into repeated phase-entry changes. Additional invoice items can charge again in a new phase; reject nonempty additions until no-duplicate semantics are supported.                                                                                  |
| Other provider states               | Pending updates/setup, pauses, managed billing and special schedules need explicit supported classification. Similar field names are not equivalent. A field missing from the phase schema is a verification gap, not proof it is discarded.                                                                                |

The completed mapper specification and recovery contract must independently fit
the configure/reconciliation ticket's estimate before write implementation starts.
Split further when needed, preserving the complete cross-product renewal outcome.
Unsupported boundaries must remain visible to the host and in acceptance criteria.
Controlled unit tests alone cannot qualify live preservation or consumer policy.
