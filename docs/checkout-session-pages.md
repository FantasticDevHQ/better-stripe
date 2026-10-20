# Buyer Checkout-session provider pages

`BetterStripe.getCheckoutSessionPageFromStripe` discovers one bounded page of
actual provider Checkout sessions for a V2 buyer account. It complements invoice
pages: an open or asynchronous Checkout can exist before any invoice exists.
This reader performs no provider write, component synchronization, commission
award or settlement operation.

```ts
import type {
  CheckoutSessionPageOptions,
  ProviderCheckoutSessionPage,
} from "@fantastic.dev/better-stripe";

// Obtain the personal buyer account from authenticated host-owned mapping.
const options: CheckoutSessionPageOptions = {
  customerAccount: authorizedBuyerAccount,
  limit: 25,
  cursor: previousPage?.continueCursor,
};
const result: ProviderCheckoutSessionPage =
  await stripe.getCheckoutSessionPageFromStripe(ctx, options);
```

The server-only Vite reference is
`example/convex/billing/checkoutHistory.ts`. Its buyer identity must come from
host authentication. The demonstration's browser personas are not production
authorization. It obtains the personal account from the component, rejects
missing, foreign or organization mappings, and overrides any browser-supplied
account selector. Existing React `Checkout` workflows remain responsible for
checkout presentation; hosts such as Dojo retain their own styles and routing.

## Selectors and results

- `customerAccount` must be a V2 `acct_…` identifier. Legacy customer selectors
  and arbitrary provider parameters are rejected.
- Optional `status` is `open`, `complete` or `expired`. Omit it when discovering
  all lifecycle states. Paid-only invoice discovery cannot find unresolved
  Checkouts with no invoice.
- Optional `created.gte` and `created.lte` are inclusive integer Unix seconds.
  An empty range object is normalized away. Creation time is not payment time;
  an older session can complete or become paid during a later membership episode.
- `limit` defaults to 25 and must be an integer from 1 to 100. It may change
  between pages. `cursor` is opaque and bound to buyer, status and creation range.
  It is a continuation selector, not a signed authorization token.
- Results contain `page`, `hasMore` and `continueCursor`. Raw lifecycle values,
  metadata, original currency/amount units and expanded subscription/payment
  references are preserved. A complete session, payment reference or amount is
  not independently proof of payment, refundable proceeds or affiliate credit.

The reader validates buyer/resource identity and selected status/time filters.
It rejects oversized pages, duplicate IDs within a page, a repeated immediately
preceding continuation ID, and empty nonterminal pages. Provider failures
propagate instead of becoming empty successful history.

## Host reconciliation

These are mutable provider pages, not an atomic snapshot or a complete-history
attestation. A stateless cursor cannot remember every earlier page. Hosts must
retain bounded durable checkpoints and seen IDs, detect cross-page overlap,
cycles and reordered/new records, and revalidate canonical buyer, community,
episode and registered request lineage before making a business decision.

An exhausted page alone does not prove absence. Missing/unregistered provenance,
unmapped references, incomplete scans, truncated related-resource previews,
unsupported lifecycle states and unresolved asynchronous attempts remain
unknown. Provider retention does not prove historical absence. Reconcile
actual supported session, subscription and invoice reads with immutable trusted
paid facts. Guard provider-read/database races and same-second ordering; do not
replace historical payment time with event arrival or deployment dates. This
reader does not fill referral locks or change already settled awards.

Buyer ownership is determined by the required, exact `customer_account` value.
Stripe may also return a legacy `customer` projection on the same session;
that field is preserved without being used for ownership. A legacy customer
alone, a missing V2 account, or a different V2 account is rejected.
