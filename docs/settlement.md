# Verified settlement and recipient payouts

BetterStripe owns provider reads, immutable settlement claims, transfer execution,
and recovery. Your server authenticates the caller, resolves recipient accounts,
selects rates, and authorizes the allocation. Never accept these values directly
from a browser. Amounts below are integer minor units in one currency.

## Read, allocate, settle

```ts
import { allocateSale } from "@fantastic.dev/better-stripe";

const sale = await stripe.getVerifiedSale(ctx, {
  paymentIntentId,
  invoiceId, // Required for a subscription payment
  subscriptionId,
});
if (sale.status !== "ready") {
  // Only retry when sale.retryable is true. Missing processing fees are not zero.
  return sale;
}
const allocation = allocateSale({
  gross: sale.gross,
  processingFee: sale.processingFee,
  feeBasisPoints: 900,
  creatorAccountId,
  affiliate: { destinationAccountId: affiliateAccountId, basisPoints: 2000 },
  collaborators: [
    { destinationAccountId: collaboratorAccountId, basisPoints: 2500 },
  ],
});
return stripe.settleSale(ctx, {
  paymentIntentId,
  invoiceId,
  subscriptionId,
  allocation: {
    gross: sale.gross,
    currency: sale.currency,
    processingFee: sale.processingFee,
    platformNet: allocation.platformNet,
    transfers: allocation.transfers,
  },
});
```

`allocateSale` is pure. The inclusive sale fee is the greater of actual Stripe
processing and the selected gross percentage. The platform keeps the difference.
An affiliate receives a percentage of the amount after that fee, or a
`fixedAmount` in minor units, capped at the amount available. Collaborators
receive their percentages of the creator remainder. Rounding residue stays with
the creator. Omit the affiliate for zero commission; no application rate is built in.

`getVerifiedSale` expands the charge's actual balance transaction, verifies
currency and paid invoice linkage, and reads the subscription's current price.
It refuses refunded/disputed charges, converted settlement currencies, partial
invoice payments, and multi-price subscriptions rather than guessing allocations.
A `pending` result carries a retryable reason; `not_payable` must not trigger a transfer.

`settleSale` verifies the provider data again, then pins the original allocation
by charge. Retries use that original allocation even if rates have changed. The
shared transfer engine records legs in the existing component transfer ledger;
there is no required application `storeSales` table. Optional signed
`adjustmentAmount` accounts for an authorized application credit or recovered
cost; it must reconcile with all other amounts. An optional `onSettled` callback
runs after execution and can run again on retries: make application writes
idempotent by source charge.

Provider transfers carry the source charge and recipient role. If Stripe succeeds
and persistence fails, retries reconcile provider records before creating missing
legs, including legacy ungrouped transfers. Incomplete provider history fails
closed. Existing refund/dispute reversal APIs recover these original legs too.
Stripe API idempotency is an additional safeguard, not the only recovery record.
Do not delete financial component records while payments can be retried or reversed.

The Vite example exposes a [fee-first allocation preview](http://localhost:5173/demo/allocation)
from Admin → Testing Utilities. Its illustrative inputs use the public helper
and the package React `SplitBreakdown`; they do not alter store settings.

## Affiliate commission recovery

Refund and monetary-dispute recovery uses each original affiliate transfer's
allocated commission, including fixed amounts, rather than current payout rules.
Successful refunds accumulate independently for each original invoice payment;
refunds do not reset one-time subscription eligibility. Refund and dispute
exposure share the same original-principal axis, capped at the original commission.
New affiliate reversal operations retain exact provider receipt references and
separate reserved funds from confirmed recovery.

The recovery ledger reserves same-currency debt offsets before future affiliate
transfers leave the platform, including fully withheld commissions with no Stripe
transfer. Won disputes restore actual reversals/offsets while retaining independent
refunds. Unknown outcomes retain reservations until exact receipt reconciliation. Before migrating or
using these records, read the [clawback API, migration and reconciliation guide](affiliate-clawbacks.md).
Seller cost recovery remains separate from affiliate commission principal.

## Subscription commission terms

```ts
const commission = await stripe.selectCommissionInvoice(ctx, {
  subscriptionId,
  invoiceId,
  affiliateAccountId, // Server-validated identity
  term: "one_time", // Default: "forever"
});
```

This selects eligibility, not a rate or a money movement. `one_time` selects the
earliest paid nonzero invoice from complete provider history, even if a renewal
arrives first. Failed invoices and zero-value trials do not consume eligibility.
The component pins the term and affiliate identity. Refunds do not reset the
first invoice. A replay returns the same `claimKey` and eligibility so interrupted
settlement can finish; deduplicate actual payment execution with `settleSale`.
If historical pagination exceeds the configured bound, selection refuses to guess.

The Vite example migrates its old subscription claims with
`pnpm exec convex run commissionMigration:run '{}'` from `example/`. Repeat until
it returns `0`. Run this after deploying the new component and before replaying
historical subscription events. The migration preserves terms and first invoices;
its batch deletes are transactional with component writes.

## Payout snapshots

```ts
const snapshot = await stripe.getPayoutSnapshot(ctx, {
  stripeAccountId,
  cursor,
  limit: 25,
});
```

The snapshot contains per-currency `balances`, cursor-paginated `payouts`,
deduplicated pending/in-transit `upcoming`, and `nextCursor`. Arrival dates are
provider estimates, nullable, in milliseconds. `upcomingComplete: false` means
only a bounded preview was retrieved. An unavailable account returns
`status: "not_ready"` with empty data and a reason; it does not imply a zero balance.
The React `PayoutSnapshot` contract accepts this shape directly.

A transfer moves money to a connected account; a payout moves that account's
available balance to its external bank. These boundaries have different controls.

## Combined payout minimums: supported boundary

A single user-level recipient account naturally combines creator and affiliate
funds across communities. Keep currency balances separate. Only available funds
are mature; Stripe's available balance already reflects provider debits and known
reversals. A platform source ledger is still necessary to explain which earnings
remain owed and distinguish unrelated funds in an already-mixed account.

The supported default is Stripe-managed automatic payouts with no additional
application minimum. Stripe enforces its applicable currency/method floor. The
Balance Settings API does not expose a numeric payout-floor field; this package
does not invent one. `minimum_balance_by_currency` is a retained reserve after a
payout, **not a minimum payout trigger**. [Stripe reserve documentation](https://docs.stripe.com/payouts/minimum-balances-for-automatic-payouts).

Custom application thresholds need a separately controlled release boundary:

- Before transfer: retain funds on the platform and maintain a durable payable
  ledger, maturity, adjustments, and release claims. This changes settlement timing
  and must account for existing transferred balances.
- Before bank payout: use a manual payout schedule where the platform has
  permission, and run an automatic application job. Otherwise provider automatic
  sweeps can bypass the application threshold. A retained reserve cannot fix that.

Manual holding limits depend on country: Thailand 10 days, US 2 years, other
countries generally 90 days. Schedule permissions depend on account controls and
liability. Negative balances, refunds, and in-flight payouts must reduce any
release amount; source-category thresholds and currency netting are unsafe.
See [payout schedule permissions](https://docs.stripe.com/connect/manage-payout-schedule)
and [manual payout restrictions](https://docs.stripe.com/connect/manual-payouts).

Custom threshold enforcement is not provided by the snapshot or settlement APIs.
It requires a selected retention boundary and migration policy. Applications must
not describe a displayed threshold as enforced while Stripe controls automatic
payouts. A numeric below/exact/above provider-floor demonstration is unavailable
without a supported provider floor read; surface this capability limitation.
