# Private renewal invoice acquisition

The private invoice observer extends fresh renewal evidence with a separately
authorized invoice pair. It has no public SDK export. Both production profiles
remain empty; implementing the private path does not activate provider access.
The original schedule-first 44-GET observer keeps its existing result layout and
does not fetch invoices.

The invoice wrapper uses the same actual Action invocation, selected SDK client
and original 30-second lifetime as its base observation. Base reads still acquire
the retained owned schedule, original subscription, target price, billing
customer and bounded coupon inventory. Invoice acquisition adds at most seven
GETs, giving a maximum of 51 provider calls. Requests have no body, no idempotency
key, zero retries and the fixed `2026-09-30.endive` API version.

## Dedicated invoice permission

A fixed host query authenticates its own `ctx.auth` and authorizes the exact
`renewal_invoice_evidence_v1` capability. Its closed arguments bind the trusted
installation scope, parent/configure operation IDs, platform mode, null connected
account, livemode, customer account, billing Customer ID, original subscription,
owned schedule and the two pinned invoice IDs. The Customer ID comes from the
retained billing customer and must match fresh customer relations. An account ID
alone does not grant access to its customers' invoice bodies.

The response repeats these arguments with the authenticated token identifier,
authorization ID, positive revision and expiration. Both the original operation
grant and dedicated invoice grant are rechecked before each additional GET and
before releasing protected output. Each response must remain equal to its own
first captured grant. Generated Convex query references are bound by their fixed
Source association and captured semantic address.

The earliest original lifetime, base expiration or invoice expiration wins.
There is no new timer or renewed expiration. Revocation, context/profile/address
drift, changed SDK configuration and timeout refuse protected output. The actor
can be consumed once. Late completion cannot authorize a new read or release.

## Pinned requests and complete inventories

The original invoice ID comes only from the retained original subscription's
`latest_invoice`. The current ID comes only from the first fresh original
subscription response. Missing pointers leave invoice evidence unavailable.
Equal IDs cannot establish a distinct-period pair; this does not turn an
ordinary pending observation into a broader conflict. No search, date inference,
matching-resource adoption or replacement pointer is used.

Malformed, deleted or foreign expanded references refuse without fallback.
Rich expansions retain all fields and must match the separately fetched complete
invoice; they do not skip that GET. Each invoice body must match its pinned ID,
mode, account, customer and original subscription before requesting its lines.

For each invoice, the plan fetches the fixed body path and
`/v1/invoices/{id}/lines?limit=100`. A second page is allowed only when the first
declares `has_more:true`. Its cursor is the last validated line ID. The plan never
follows `page.url`; that field must match the fixed invoice-lines pathname.
Line object, mode and invoice ownership are checked before cursor adoption.
Duplicate IDs, including aliases across the two invoices, invalid cursors,
oversize pages, empty continuations and a second page with more data refuse the
pair. There is no third page or truncation.

One final subscription GET must equal the complete earlier fresh subscription
response. Pointer or material drift refuses the pair; the observer does not
adopt the fence response or restart acquisition. Partial inventories never enter
the analyzer as a complete `invoiceContext`.

## Result meaning

The invoice wrapper adds `invoiceContext`, `invoiceInventory` and `invoiceReason`
to its private DATA output. A complete inventory means the bounded resources were
acquired, not that their billing material qualifies. The existing seven-input,
twelve-result analyzer checks item/successor identity, native periods, exact
price/product/currency, non-proration and decimal strings. It preserves full raw
resources and wire decimal text. Invoice status does not establish payment,
entitlement, consent or exclusive causality.

Actual SDK rejection returns bounded diagnostics and retained receipts only
after both final grants succeed. Authorization and decoding failures propagate;
they do not become fabricated provider rejections. No protected DATA is released
after timeout or revocation.

The final authorization and subscription fence are checked points. Sequential
invoice bodies and line pages do not form an atomic snapshot or prove
uninterrupted permission. Historical native witness acquisition remains a
separate requirement. Live provider qualification, genuine generation, deployed
compatibility, operational binding and Dojo acceptance are still required.
