# Reactive history and currency totals

`BetterStripe.paginateProducts`, `paginatePrices`, and `paginatePayouts` read
webhook-synchronized component records. They return standard Convex
`{ page, isDone, continueCursor }` results. Pass `paginationOpts` with an opaque
`cursor` or `null` and an integer `numItems` between 1 and 100. These readers use
one indexed pagination call per invocation, ordered newest first. Existing array
methods remain available. Neither an array preview nor one cursor page is an
exact financial total.

Products support `accountId` and `active`. Prices support the component's
`productId` and `active`; this ID differs from `stripeProductId`. Authorize the
parent product before exposing price reads. Payout history requires `accountId`
and optionally accepts `status`. No filter means no restriction on that field.
An omitted product account filter includes all accounts, including platform
products. Host applications must derive allowed account and product scope from
the authenticated user. A client-supplied account ID is not authorization.

The Vite reference provides bindings in `example/convex/readContracts.ts` and
`example/src/lib/stripe-hooks.ts`. Its selectable personas are demo identities.
Production hosts must replace them with session authorization.

## React pagination

Wrap the public client method in an authorized host Convex query with
`paginationOptsValidator` in its arguments. Return the package result unchanged.
Bind that query with `useComponentPaginatedQuery` from the package React export.
This uses the helper-compatible hook to pin end cursors when another page loads.
Native `convex/react` pagination does not pin component helper cursors and can
leave gaps when new rows arrive between loaded pages.

```tsx
const products = useComponentPaginatedQuery(
  api.catalog.paginateProducts,
  {}, // Host derives account scope from the session.
  { initialNumItems: 25 },
);
const manager = useProductManager({
  scopeKey: authenticatedUser.id,
  createProduct,
  createPrice,
  updateProduct,
  deactivateProduct,
  deactivatePrice,
});
// Render products.results with the existing Products/useProductManager callbacks.
// Expand each product with a separate useComponentPaginatedQuery for its component productId.
// Do not join unbounded prices onto every product in a page.
<button
  disabled={products.status !== "CanLoadMore"}
  onClick={() => products.loadMore(25)}
>
  Load more products
</button>;
```

Use the standard `LoadingFirstPage`, `LoadingMore`, `CanLoadMore`, and `Exhausted`
statuses for loading, empty, and terminal states. Queries react to writes
and reset when their arguments change. Keep price hooks in a child component
keyed by product ID. Do not invoke hooks inside a variable-length loop. A payout
history binding uses the same contract. Pinned ranges can grow beyond the requested
page size. The server caps each read at 200 rows or 1 MB and returns split hints
for the hook to split large ranges without dropping rows. The `Payouts` workflow's live snapshot
loader remains a separate Stripe action API, not a substitute for reactive
component history or exact paid totals.

## Exact totals by currency

Use `getAccountEarningsByCurrency` and `getAccountPayoutsByCurrency` through the
client or component. They return `totals` sorted by currency and bounded
`transfers` or `payouts` previews. `previewLimit` is an integer from 0 to 100,
defaulting to 50. Earnings totals include `gross`, `reversed`, `net`, and
`transferCount`; payout totals include `paidOut` and `payoutCount`. Only payouts
with status `paid` contribute to `paidOut`. Reinstatement transfers contribute to
gross, while the original transfer's reversal remains recorded.

All amounts use the currency's original minor units. Never add different
currencies, or apply a fixed two-decimal conversion to JPY or KWD. The package
maintains summaries transactionally with every supported transfer and payout
mutation, including reversal mutations. Reads examine at most 501 summary rows,
one unbackfilled-row probe, and 100 preview rows, regardless of history size.
Accounts with more than 500 distinct currency strings fail explicitly. Summary
updates serialize per account/currency through Convex OCC.

Bind authorized wrappers to `createUseCurrencyEarnings(useQuery, earningsRef,
payoutsRef)`. Its `totals` joins the two summaries by currency and never sums the
previews. Render an `EarningsSummary` for each currency, passing that row's
`currency` and only that currency's payout preview. The default earnings formatter handles supported ordinary charge currencies.
Pass an explicit `formatAmount` callback for other observed currency precision,
including KWD, or render the raw typed totals with your own currency policy.
Use `getAccountBalance` or
`getPayoutSnapshot` for per-currency available/pending balances. The component's
earnings ledger does not determine settlement availability.

### Existing installations

Summary amounts, counts and derived net amounts must remain safe integers in the
public Number representation. Checked integer intermediates reject fractional,
non-finite or unsupported inputs/results before rounding. A rejected transfer,
payout, reversal or backfill page rolls back its source changes, markers and
summary updates together. Stored unsafe summary fields also fail closed on reads.

These guards prevent new precision loss; they do not repair summaries rounded by
an earlier release. An affected historical summary needs reconciliation against
its original records before reuse, even if a later rounded value appears safe.
The ordinary backfill below skips already-marked records and cannot repair that
case. Do not treat a successful backfill or a current safe-looking Number as
proof that previously unsupported arithmetic was exact.

After deploying the optional marker fields and summary table, invoke
`components.betterStripe.earnings.mutations.backfillCurrencyTotals` from a trusted
server migration. Run separately for `kind: "earnings"` and `kind: "payouts"`,
starting with `cursor: null` and continuing with each `continueCursor` until
`isDone`. Each mutation visits at most 100 rows. Retrying a page is safe, and
ordinary package writes can continue during migration. A row's marker and its
summary contribution commit together. New readers throw while an account has
unbackfilled rows, so callers cannot mistake incomplete totals for zero.

Keep raw imports and direct database edits out of normal application writes.
If importing historical ledger rows, omit `totalsRecorded` and run the backfill.
Never copy markers without their matching summaries.

Legacy `getAccountEarnings`, `getAccountPayouts`, and `createUseEarnings` retain
their single-currency shapes. The legacy queries now reject mixed-currency
accounts and direct callers to the new methods. Their historical scans remain
subject to Convex read limits; migrate busy accounts to the maintained summaries.
Full referred-sale history uses `paginateTransfersByAccount`, not the preview.

## Current payout observations

Call `betterStripe.syncPayoutFromStripe(ctx, { stripePayoutId, scope })` from an
authorized server action. Use `scope: { type: "connected", accountId }` for the
recipient's connected account or explicitly use `scope: { type: "platform" }`
for a platform payout. Resolve scope from trusted host configuration and recipient
ownership. Never accept an arbitrary account or platform mode from the browser.
The method reads Stripe and updates the existing component payout record; it
never creates, cancels or releases a bank payout.

The operation works for Stripe-managed automatic and manually triggered payouts.
It retrieves the current payout under that account's Stripe request scope and
validates the payout identity, original amount and currency, status, arrival date,
method and failure details. It does not require a mature balance transaction or a
manual execution claim. A current status observation does not establish funding
maturity, payout eligibility or a policy minimum.

A durable claim assigns each read a per-payout generation. Only the newest
claimed generation can commit. A delayed older response returns `superseded`
without changing the financial row. A successful result returns `accepted`, its
generation, `changed` and the stored payout. Identical observations preserve the
financial row and exact currency totals. Retrying the same committed generation
also preserves its acceptance timestamp. A later current provider observation
can legitimately change paid to failed; no terminal-status ranking is applied.

Provider errors or invalid snapshots throw and leave the last accepted financial
observation intact. The latest incomplete claim becomes unknown when that marker
can be saved. A lost mutation response may leave a pending or already accepted
claim. Retry the operation to obtain a new generation and read Stripe again.
Never substitute the webhook event body when the current provider read fails.
The claim table holds reconciliation metadata, not a second money ledger.

Signed payout notifications use the same current-provider preparation and durable
generation. The signed event account selects connected scope; an absent account
selects platform scope. Event metadata and bank destinations cannot select an
account. Created, updated, paid, failed and canceled events all follow this path.
Unavailable provider state fails delivery for retry and preserves the previous
financial observation. There is no event-body fallback or terminal-status ranking.

When a host registers the shared `webhookHandlers()` pair, the accepted generation,
payout write and synchronized `triggers.payout` callback commit in the same host
mutation transaction. A thrown callback rolls back that financial acceptance.
Retries obtain a fresh provider observation. Superseded and unchanged observations
skip synchronized callbacks. Without host handlers, the package commits the same
guarded component mutation directly. Keep one package webhook endpoint; never
follow reconciliation with a raw old-event upsert.

Existing event-ID deduplication remains in place. Raw `onEvent` and event-specific
hooks retain their original signed event payloads and separate delivery semantics;
they are not current-state financial observations. Host notifications must own
their deduplication and retry policy. Legacy records with unverified or conflicting
account bindings remain held for explicit reconciliation rather than foreign
adoption.

## Payout failures

Component payout rows and live `RecipientPayoutRow` snapshots expose optional
`failureCode` and `failureMessage`. A later accepted snapshot with absent or null
provider failure fields clears stored details. Legacy rows remain valid.

Host apps should translate known codes into safe recovery instructions and a
settings link. Do not log or blindly render raw provider messages. Authorize
reads using the recipient's shared connected account.

## Prepared Checkout requests

Use `betterStripe.checkoutRequests.prepare(ctx, options)` when a host purchase
intent must bind the exact provider request before creation or a plan change's
cancellation. Preparation performs only reads. It never provisions an account,
creates a Checkout Session or cancels a subscription. If a buyer needs a V2
customer account, register the host intent first, provision through the existing
package account operation with a stable account identity, then prepare using the
verified account reference.

Preparation returns a serializable versioned snapshot containing the final
`request`, component correlation `row`, captured rendering `options`, descriptor
and generated routing metadata. Persist the entire snapshot in the host's owned
intent before any subsequent provider write. The snapshot includes account or
customer email, server metadata, quantity, trial behavior, nested overrides and
resolved fees. Its contents may contain private data; do not return the snapshot
to a browser or log it.

Call `betterStripe.checkoutRequests.execute(ctx, { prepared, idempotencyKey })`
with that persisted snapshot and a stable intent-derived key. Execution validates
its correlation and deterministic rendering against the captured context, then
sends the stored request unchanged. It does not resolve current fee or descriptor
defaults. Necessary platform-price checks may still read the provider. If a key
was explicitly included during preparation, execution must use the same key.
Retries reuse the exact request and preserve the existing Checkout response shape
and component upsert. Missing or conflicting keys and inconsistent snapshots
fail before creation.

The host must authorize the buyer and catalog, bind the complete snapshot and key
immutably, validate fresh session eligibility and own recovery. Consistency
validation is not a signature or a replacement for host authorization. Never
accept a browser-supplied snapshot. An unknown provider outcome remains unknown;
use authoritative provider reads and saved references rather than blindly
recreating after an idempotency retention window. This API does not record paid
facts, award attribution, grant access or cancel a current plan automatically.

For a plan change, authorize and register the intent, prepare and bind a request
with no new trial, then perform any authorized cancellation before executing the
persisted request. Preserve cancellation and creation recovery separately. A
failed or lost response does not establish successful cancellation or payment.

The original `createCheckoutSession` uses the same maintained renderer and
submission path and retains its existing behavior. The prepared contract adds
strict correlation checks for the buyer, account and price and preserves
server-owned metadata and package-generated routing markers. Application React
callbacks remain authenticated host adapters. The package's unstyled React
checkout workflow and Vite example can use these callbacks with application styles.

## Publication and consumer acceptance

A source merge does not activate an API in a published package. DOJO-908,
DOJO-1037, DOJO-1041, and DOJO-2257 require a verified published version and
explicit consumer adoption, authorized adapters, translated UI, and their own
acceptance evidence. These package changes do not complete those tickets or add
a second Dojo financial ledger, payout table, catalog store, or webhook processor.
Use the repository release workflow; do not publish npm manually.

## Provider invoice pages

`getInvoicePageFromStripe(ctx, { customerAccount, limit, cursor, status, created })`
reads one provider invoice page for a canonical V2 buyer account. `limit` is an
integer from 1 to 100, default 25. `created` optionally supplies inclusive Unix-second
`gte`/`lte` bounds. An omitted status includes all statuses. Return values are
`{ page, hasMore, continueCursor }`; pass the opaque continuation unchanged with
its original account, status and time-window scope. The cursor binds selectors,
not authorization or tamper-proof completeness. Hosts must retain server-owned continuation checkpoints when deriving historical coverage; a browser-supplied cursor cannot prove complete enumeration. The host must derive and authorize the buyer account before
every invocation. Do not expose arbitrary account selectors through a browser.

Invoice objects retain original provider units, currencies, subscription
references and `status_transitions.paid_at`. Nested `lines.has_more` is preserved;
a partial line preview cannot prove a complete invoice. A foreign buyer row,
invalid continuation or non-advancing has-more response rejects. Provider failures
retain their original identity rather than becoming empty completed pages.

This action is distinct from webhook-synchronized `listInvoices` and from the
reactive component pagination hook. Enumerating provider pages does not prove
that no earlier paid purchase exists, that every purchase is represented, or
that payment state remains unchanged after a read. Do not use webhook retention,
local installation dates, arrival timestamps or a capped subscription preview
as proof of absence. Hosts must retain unknown historical gaps, correlate actual
community/episode resources, handle repeated observations and guard the
provider-read/database race before granting referral attribution. This API
creates no financial records, commission awards, locks or settlement operations.

The Vite server-only reference `example/convex/billing/invoiceHistory.ts` derives the
V2 account from a retained personal buyer mapping after its caller authorizes
the buyer. It accepts no account selector from the caller. Production hosts need
real session authorization; selecting a demo persona does not provide it.

## Provider invoice payment references

`getInvoicePaymentPageFromStripe(ctx, { stripeInvoiceId, customerAccount,
stripeSubscriptionId, limit, cursor })` verifies the known invoice's canonical
V2 buyer and subscription on every request, then enumerates the dedicated
invoice-payments endpoint. Its bounded `{ scope, page, hasMore, continueCursor }`
result preserves original provider rows and canonical PaymentIntent references;
unsupported or unavailable references remain visible. Embedded invoice payment
previews are not complete lists. See [invoice payment references](./invoice-payment-pages.md)
for the public contract, pagination failures and host obligations.

Invoice allocations are not the PaymentIntent's remaining refundable balance.
The host authorizes the actual session, verifies original merchant and sale scope,
and revalidates creation-time eligibility through the existing refund APIs. This
reader writes no financial records and changes no access or subscription state.

## Provider Checkout-session pages

`getCheckoutSessionPageFromStripe(ctx, { customerAccount, status?, created?,
limit?, cursor? })` discovers actual V2 buyer Checkout sessions, including open
or asynchronous sessions that have no invoice yet. It preserves raw lifecycle,
metadata and payment/subscription references and performs no synchronization or
financial write. The server-only Vite adapter derives its account from the
host-authorized personal buyer mapping.

See [Checkout-session discovery](./checkout-session-pages.md) for public types,
scope-bound continuation, response validation and host obligations. Within-page
duplicates and immediately repeated continuation IDs reject; cross-page overlap
requires host checkpoints and seen-ID reconciliation. Neither an exhausted page
nor a complete Checkout status proves historical absence or payment. Unknown
provenance, mutable provider states and provider-read/database races remain host
responsibilities before any referral qualification or award.

## Refund context

`getRefundContext(ctx, { stripePaymentIntentId, actor, maxRefundPages?,
stripeAccountId? })` observes the authorized original captured charge and complete
bounded refund history. It returns a ready original-currency remainder or an
explicit unavailable reason, and propagates provider failures. Required actors,
partial-capture units, history budgets and creation-time host obligations are
specified in [refund context](./refund-context.md). Invoice allocations and
authorized gross amounts are not remaining refundable principal. No access,
subscription or financial state is changed by this reader.
