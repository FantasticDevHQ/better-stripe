# Renewal context reads and attachment request preparation

`BetterStripe.readRenewalPriceReplacementContext` reads the original provider
subscription, authorized target price and correlated billing Customer. Hosts
must authorize the caller and exact original selectors before invoking it on
the server. This method does not create or update provider resources, persist
operation ownership or establish financial preservation.

```ts
const context = await betterStripe.readRenewalPriceReplacementContext(ctx, {
  expected,
});
const prepared = prepareRenewalPriceReplacement({
  subscription: context.subscription,
  targetPrice: context.targetPrice,
  billingCustomer: context.billingCustomer,
  expected,
  key: logicalKey,
});
const attachRequest = prepareRenewalScheduleAttachment({
  prepared,
  apiVersion: context.apiVersion,
  attachKey,
  firstDispatchedAt,
});
```

The two preparation functions are pure exports. The host supplies and durably
retains the logical key, explicit attachment key, original first-dispatch time
and complete records under immutable authorization. An explicitly chosen attach
key may equal the logical key; no key is silently reused, derived or generated.
A future configure key must differ from the attachment key.

## Fixed acquisition profile

The initial profile supports platform requests using the configured
`2026-09-30.endive` API and Stripe 23 read shapes. Other versions reject before
reading. The public class selects the maintained single-attempt client,
including protection against the SDK's closed-connection special retry; every
read also requests zero automatic retries. Failures remain visible. There is no
fallback expansion, alternate endpoint or stale cache after a failed read.

The method performs these planned GETs in order:

1. Retrieve the exact subscription with `discounts`, `items.data.discounts`
   and `items.data.price` expanded.
2. Retrieve the exact target price.
3. Retrieve the actual subscription's Customer, correlated to the authorized
   customer-configured account and mode.
4. Retrieve each distinct coupon referenced by the expanded subscription/item
   discounts, in first-occurrence order. Each level is capped at 20 discounts,
   so at most 40 coupon GETs follow the three original reads.

Discounts must be expanded and have an actual coupon source. There is no
Discount retrieval endpoint used here. The item path
`items.data.discounts.source.coupon` exceeds the provider's four-property
expansion limit. Explicit coupon GET joins are part of the initial read plan,
including when a coupon was already expanded. Same-ID undeleted coupon results
expand string references in the canonical context. If a coupon was already
expanded, its complete canonical JSON must equal the separate GET result.
Duration, applicability, unknown fields and ordered arrays must agree; object
key order does not matter. Minimal expanded references and original-only or
GET-only fields are conservatively rejected as unsupported read-shape drift.
The join never merges or overwrites existing full source facts. Repeated
references are each compared, even when their coupon GET is deduplicated.
Contradictory available mode facts reject before a coupon GET.

All other full JSON fields, array ordering and unknown provider data are
retained within the existing bounded snapshot policy. No missing values become
null or empty lists. The result records `readProfile: "renewal-context-v1"`, a
server observation time and `providerQualification: "required"`. It does not
promise that multiple reads were atomic or that a context remains fresh later.
A preparation supplied from a different expansion/read shape must not be
silently rebound to this profile during a future writer invocation.

A nonnull observed `subscription.schedule` is returned as an observation. It is
not adopted as an acknowledgement of attachment. The existing initial pure
preparation still requires an unattached original. A later explicit replay of
an unknown attachment result needs a distinct material-state guard permitting
the actual nonnull association while preserving the original retained snapshot.
This reader does not fabricate a null association to bypass that guard.

## Bound request and remaining writer contract

The pure builder validates the retained logical preparation and explicit key.
It binds version, attach stage, platform scope, actual API version, logical
binding, method/path, complete payload `{ from_subscription: subscriptionId }`,
key and original first-dispatch time. It generates no phase, metadata, arbitrary
create option, receipt or provider acknowledgement.

No attachment writer is exposed by these helpers. There are currently no
accepted provider execution profiles. A positive structural preflight remains
insufficient to authorize a POST; callers cannot unlock one with a qualification
flag. Direct existing forever discount IDs are representable by the projection
helpers, while actual mirroring and preservation require separate provider
qualification. Empty discount reads do not prove suppression versus inheritance
and remain unsupported at projection preflight, even when the Customer has no
observed discount. Reading such facts does not qualify their transition.

A future writer must reacquire this full scoped context before its one POST.
Initial dispatch requires no attached schedule. Explicit lost-response replay
must use the same retained full request/key/time, permit a newly observed
nonnull association without adopting it by shape, and keep provider conflicts
visible. A local replay age limit below 24 hours cannot guarantee replay after
provider pruning. No retries, configure chaining or cancel/release rollback are
implemented here. A successful future attachment acknowledgement must remain
`attached_unconfigured`; target pending/effective states require separately
qualified configuration and observation.

See the [replacement contract](renewal-price-replacements.md) and
[phase assembly](renewal-phase-assembly.md) for baseline, replay and observation
boundaries. Read comparison is best effort and cannot exclude concurrent
Dashboard or other provider writers.

## Wire JSON and transport status

Renewal reads use Stripe's public `rawRequest` for a fixed set of subscription,
Price, Customer and coupon GET endpoints. Each resource ID is encoded as one path
segment. Dot-only coupon IDs `.` and `..` are rejected before dispatch because
URL parsing would normalize them into different resource paths. The subscription's
fixed ordered expansion query is in the GET path,
with no GET body. Callers cannot supply endpoints, headers or expansion options.
The API version, platform scope and zero automatic network retries remain fixed.

Typed Stripe resource methods can convert decimal strings into SDK `Decimal`
objects. The raw request boundary preserves the parsed wire JSON instead,
including decimal string spelling, required native Plan fields and unknown
provider fields. The strict bounded JSON snapshot validator is unchanged. No
`Decimal.toString()` conversion, financial calculation or selective field
replacement makes unsupported evidence acceptable. This preserves JSON values,
not the original response whitespace or numeric token spelling.

A fulfilled SDK promise alone does not establish HTTP success. Each renewal
response must have actual successful transport status metadata. Fetch exposes
`lastResponse.status`; Node exposes `lastResponse.statusCode`. Missing, malformed,
contradictory or non-2xx metadata rejects the read. This nonenumerable transport
metadata stays outside the canonical provider body. Provider errors stay visible,
and these read checks do not acknowledge a schedule mutation.

The shared single-attempt client rejects fetch redirects as well as Stripe's
closed-connection retry exception. A 307 or 308 cannot silently replay a POST.
The ordinary client route keeps its existing transport behavior. Rejected
redirects and broken connections can leave a remote outcome unknown; callers
must retain the original request identity rather than rotate or resend
automatically. These transport safeguards do not qualify a renewal provider
profile or authorize attachment, configuration or entitlement changes.

## Additive async V2 preparation

Use the explicitly named V2 functions when compact SHA-256 consistency bindings
are needed. Existing V1 functions and retained V1 records keep their current
format and synchronous behavior.

```ts
import {
  prepareRenewalPriceReplacementV2,
  prepareRenewalScheduleAttachmentV2,
} from "@fantastic.dev/better-stripe";

const preparedV2 = await prepareRenewalPriceReplacementV2({
  subscription: context.subscription,
  targetPrice: context.targetPrice,
  billingCustomer: context.billingCustomer,
  expected,
  key: logicalKey,
});
const attachRequestV2 = await prepareRenewalScheduleAttachmentV2({
  prepared: preparedV2,
  apiVersion: context.apiVersion,
  attachKey,
  firstDispatchedAt,
});
```

Both functions are pure. They perform no provider request, generate no key,
persist no record and establish no provider qualification. The V2 attachment
builder accepts only a complete V2 preparation. It reconstructs that preparation
from its full provider snapshot, expected selectors and retained logical key,
and compares the entire result before constructing the request. A matching
digest alone is insufficient. V1 preparations are rejected by this builder;
there is no automatic migration or fallback. Existing V1 projection, receipt
and configure consumers do not accept V2 records. This release adds preparation
and request construction only, without a V2 writer or receipt constructor.

V2 retains the same raw preparation semantic checks and bounded JSON policy as
V1. It adds a limit of 500,000 UTF-8 bytes on each exact encoded hash preimage,
including its domain tuple. A record can therefore fit V1's character limit
and exceed V2's byte limit. Inputs are captured before awaiting hashing; changes
to the original caller object during the await cannot change the result. Web
Crypto SHA-256 must be available. Missing or rejected digest operations fail
without an alternate algorithm or synchronous fallback.

For a fixed family, the hash input is the UTF-8 encoding of the current bounded
`renewalSnapshot` canonical copy followed by `JSON.stringify`, applied to
`["betterstripe-renewal-binding", 2, family, completePreimage]`. Object keys use
the existing ordering, including JavaScript's numeric-index enumeration;
arrays retain their order and negative zero serializes as zero. The output is
`family:v2:sha256:` followed by the full 64 lowercase hexadecimal digest.
Families are selected internally: `renewal` for preparation and
`renewal-attach` for the attachment request.

The preparation preimage contains version, platform scope, expected selectors,
quantity and complete provider snapshot. Its logical key is separately retained
and validated, as in V1; changing only that valid key does not change the
preparation digest. Hosts must protect original key lineage through immutable
authorization and storage. The attachment preimage binds its entire unsigned
request, including stage, scope, actual API version, logical binding, POST path,
complete payload, explicit attachment key and original first-dispatch time.
Neither digest authenticates a caller, proves provenance, acknowledges a POST
or guarantees provider replay. Hosts retain the complete original records.

These helpers retain ordinary provider and caller metadata within their JSON
limits. They do not redact, encrypt or certify that input or output is safe to
log. Do not place secrets in metadata, and protect retained full records.
