# Metered billing authorization and recovery

BetterStripe's component and server facade are trusted host APIs. The component
cannot authenticate your application's end user. Authenticate and authorize each
host query, mutation and action before calling `stripe.usage`, including every
history page, reconciliation, refund preparation and resume operation. The
example's demo role selector is not production authorization.

These rules apply to pay as you go, included monthly usage with overages and
payment-backed prepaid usage. Use native Stripe meters, meter events, managed
subscriptions and price-scoped paid Credit Grants. No Metronome account or
credential is required.

## Derive identities on the server

Resolve the actor's current tenant membership and billing role from your trusted
database. Load the authorized original binding and subscription from that tenant.
Do not accept a browser-supplied payer, seller, native Customer, Stripe account,
meter, price, provider callback, secret key, plan, currency or pricing policy as
proof of ownership. Recheck membership after an identity or tenant change.

| Boundary                                             | Host responsibility                                                        | Component/provider checks                                                                                   |
| ---------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Record, reserve and release                          | Verify the original business event, work owner and immutable quantity/time | Exact scope, source identity, original terms and matching reservation; atomic ledger, outbox and accounting |
| Catalog, subscription and Checkout                   | Authorize billing administration and resolve every meter/fixed price       | Native realm/mode, Accounts v2 payer, mapped Customer, original native price and supported collection/model |
| Usage, allowance, credit and subscription reads      | Authorize the current actor on every page; a cursor is not authorization   | Original scope/binding and bounded indexed pages                                                            |
| Allowance configuration                              | Authorize entitlement and cap edits                                        | Original binding, verified managed period and revision comparison; retained consumed/reserved units         |
| Credit purchase and observation                      | Authorize the original purchaser and application purchase ID               | Captured original payment, amount/currency/payer/Customer, realm/mode, metadata and price-scoped paid grant |
| Correction, cancellation, refund, resume and closure | Authorize the original operation and recovery role                         | Original event/payment/grant identities, immutable commands and retained unresolved liabilities             |
| Settlement                                           | Authorize original issuer/seller and affiliate policy                      | Independently verified cash source and actual processing costs; credit consumption creates no second sale   |

Provider credentials belong in server environment variables or the host's secret
store. Bind an internal provider action in trusted server code. Never accept an
arbitrary callback handle from a browser. Return a purchase client secret only to
the authenticated original purchaser. Do not persist it in documents, workflow
arguments, audit history or logs. Provider errors are sanitized; do not append raw
Stripe exceptions or HTTP payloads to a browser response.

## Reserve work before executing it

Use `reserveCredits` for prepaid work and `reserveAllowance` for a configured
allowance. Display reads such as `getCreditBalance` and `getAllowanceStatus` do not
authorize work. Competing reservations include both consumed and reserved units.
A configured allowance cannot be bypassed through ordinary `record`.

Persist a stable business event ID and deduplicate worker execution in the host.
A replay returning `committed` or `released` is not permission to run that work
again. The external worker and the component transaction are separate. A timeout
or lost response does not prove that work failed. Retain the reservation until
the original work outcome is known. Release an uncommitted reservation only after
confirmed failure or abandonment, using the original release reason.

`record` commits the exact reservation, immutable usage event, delivery outbox and
quantity counters together. Changed prepared fields, source quantity/time,
price/version, period or reservation fail rather than rewriting the original.
Provider rejection, unknown delivery and aggregation lag do not restore capacity.
Use the [correction protocol](usage-corrections.md) for accepted activity.

A cap reduction or disabled entitlement preserves previously authorized reserved
work. That work may commit once. Stop the worker and explicitly release its
uncommitted reservation if the business operation must be cancelled. Renewal
requires a current verified native managed period; calendar dates and changed
bindings cannot reset counters or reuse historical business source IDs.

## Native observations and callbacks

Use the package's signed webhook integration and configured signing secret.
Signature verification precedes dispatch. A signed event must still match the
original native realm/mode and managed intent or delivery identity. Callback
version and attempt checks reject stale delivery results. Browser redirects,
invoice paid labels and webhook payload claims do not replace fresh payment or
invoice provenance.

Managed subscription and credit reconciliation reserve an ordered observation
before native I/O. Concurrent calls within one millisecond receive distinct
orders. Older subscription results cannot replace the retained projection, and
the returned view follows that retained projection. Historical snapshots remain
available. Older credit observations return held; conflicting tied evidence
freezes the account until fresh reconciliation and authorized resume. Refresh
failures remain unavailable or retryable instead of inventing a zero balance.

Native credit PaymentIntent, Charge, Credit Grant and balance proofs must match
both the original Accounts v2 payer and its mapped native Customer. A matching
payer alias alone cannot authorize a foreign Customer. Delivery rechecks original
paid backing before sending prepaid usage.

## Bounded evidence and recovery

| Evidence                 | Limit                                                                    | At or beyond an incomplete proof                                   |
| ------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Allowance reconciliation | 500 accepted events and 500 open reservations                            | One over returns held without repairing counters                   |
| Credit reconciliation    | 100 native transactions and 10 invoice application proofs per grant      | Oversized transaction proof fails; excess applications remain held |
| Native credit inventory  | 1,000 listed grants and 100 unexpired balance reads                      | Unproven remaining inventory prevents another purchase             |
| Retained purchases       | 1,000 per original credit binding                                        | New purchase fails; exact retained replay still works              |
| Retained audit history   | 100,000 credit entries per binding; 100,000 allowance entries per period | The next transaction rolls back rather than deleting evidence      |
| History reads            | At most 100 rows per requested page                                      | Request the next page with the same authorized original scope      |

Refund preparation supports wholly unused reconciled original credits and returns
a required cash-refund step. Execute the existing authorized monetary refund on
the original payment with a stable idempotency key, then reconcile again.
Preparation does not itself execute the cash refund.

Disputes, partial refunds/use, pending work, incomplete proofs and external native
changes retain liabilities. Credit account closure requires a complete zero
balance observation no older than 60 seconds and reconciled consumption. An old
zero balance cannot bypass a later dispute or unresolved recovery freeze. Unspent
credits require a verified full original refund or their original configured
expiry. The general account-closure guard retains open credit accounts. Never
clear history, mint replacement credits, or create another purchase to bypass an
unknown result.

Usage estimates, included allowances and credit quantities report
`cashCollection: none`. Credit-funded invoice applications do not collect cash
again. See [credit accounting](usage-credits.md), [allowance limits](usage-limits.md)
and [original payment settlement](usage-settlement.md) for their separate proofs.

## Audit and verification

The co-located tests exercise the Stripe SDK transport and Convex transactions:
foreign Customer payment/grant/balance proofs, reordered concurrent native reads,
disputed consumed-credit closure, exact proof and retained-quota boundaries,
reservation races, atomic rollback, forged records, cross-scope IDs and later-page
cursor reuse. Existing webhook and lifecycle tests cover signature, native
mapping and callback-version guards. Run `pnpm run check:all` before shipping a
host integration and add tests for the host's own membership and role checks.

SDK fixtures and synthetic financial receipts are not live native financial
execution. The [native feasibility evidence](evidence/native-metering/clock-finalization-run.json)
is separately labelled. Use the [sandbox setup guide](metering-setup.md) for
credentials and native verification; never use live billing to test recovery.
