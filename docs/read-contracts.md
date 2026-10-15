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

## Payout failures

Component payout rows and live `RecipientPayoutRow` snapshots expose optional
`failureCode` and `failureMessage`. Signed payout events write the provider's
current snapshot to the existing payout identity. A later snapshot with absent
or null provider failure fields clears stored details. Legacy rows remain valid.
Ordinary event replay is deduplicated. This is snapshot reconciliation and does
not guarantee convergence for globally out-of-order events.

Host apps should translate known codes into safe recovery instructions and a
settings link. Do not log or blindly render raw provider messages. Authorize
reads using the recipient's shared connected account.

## Publication and consumer acceptance

A source merge does not activate an API in a published package. DOJO-908,
DOJO-1037, DOJO-1041, and DOJO-2257 require a verified published version and
explicit consumer adoption, authorized adapters, translated UI, and their own
acceptance evidence. These package changes do not complete those tickets or add
a second Dojo financial ledger, payout table, catalog store, or webhook processor.
Use the repository release workflow; do not publish npm manually.
