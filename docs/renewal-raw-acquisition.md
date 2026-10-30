# Internal raw renewal acquisition

The internal reader keeps the complete Subscription, target Price and billing
Customer JSON bodies separate from reconstructed Coupon joins. It does not
change `readRenewalPriceReplacementContext` or any public package export.

`createSourceRawAcquisition` takes no arguments. Its private dependencies are the
same original-operation Owner and the fixed stock Stripe delegate. The compiled
registry is empty and Source loaders remain unbound, so normal package use cannot
start this reader or make a request through it. There is no caller-supplied
client, clock, qualification flag or replacement deadline.

## Read sequence and data

The fixed sequence reads the Subscription with `discounts`,
`items.data.discounts` and `items.data.price` expansions, the target Price, then
the billing Customer. Subscription and item discounts each have at most 20
entries. Coupon reads follow first appearance across those lists, deduplicated
by ID, for at most 40 Coupon reads and 43 direct helper GET calls altogether.
Expanded Coupon equality is checked immediately after its read, before another
Coupon request can start.

A successful result contains `wireSubscription`, `wireTargetPrice`,
`wireBillingCustomer`, `couponReads` and `derivedCouponJoins` inside `bundle`.
The joins retain each discount's source index, original Coupon reference and
read index. They do not replace the discounts in the raw Subscription. Unknown
JSON fields, counters, decimal strings and own `__proto__` data survive the
bounded copy. A non-null Schedule association remains an observation; the reader
does not create an attachment receipt or fetch a Schedule.

Every original identity, account, mode and paid-period predicate still applies.
Each body and the complete result must fit 500,000 JSON characters and UTF-8
bytes, 10,000 visited nodes and depth 40. Duplicate occurrences count again.
Credential-bearing fields and text, getters, symbols, cycles and Proxies are
unsupported. Only the own nonenumerable `lastResponse` transport augmentation is
removed from an otherwise fully retained JSON body.

## Lifetime and transport

The first action after every raw request settles is a check against the same
original Owner. The reader checks before reflecting on the reply or metadata,
before another request, and before returning a detached, frozen result. Its
single-use child lifetime closes after completion without retiring the outer
Owner. It cannot renew the original wall or monotonic bounds.

A reply needs consistent 2xx transport status. Plain Node own-data metadata and
the captured builtin status getter on the exact native Fetch `Response`
prototype are supported. Arbitrary metadata getters, subclasses, cross-realm
responses and contradictory status fields are refused.

Each request fixes API version `2026-09-30.endive` and
`maxNetworkRetries: 0`. A future Source client binding must also select the
maintained `getStripeClient` SingleAttempt policy, whose HTTP client rejects
redirects and guards the SDK closed-connection retry. Per-request options alone
do not establish that client configuration. The current Source binding is
unbound.

Failure returns the fixed content-free `RAW_ACQUISITION_STOP` result; partial
bodies and raw errors are not exposed. `observedAt` comes from the accepted
original Owner sample. Success labels explicitly leave source fulfillment,
clock provenance and operator readiness false. The 43-call bound counts helper
invocations, not a network trace. These internal mechanics do not establish
provider execution, custody, an authenticated clock, attachment dispatch or a
qualified operational profile.
