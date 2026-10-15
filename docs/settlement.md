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

## Recipient-held payout policy controls

`stripe.payoutPolicy` stages versioned, account-wide schedule changes for a
user-level recipient. The host authenticates `ownerKey`, authorizes the policy,
and records explicit consent. Thresholds use integer minor units per currency;
they combine creator and affiliate funds rather than creating category gates.
The untouched default remains Stripe-managed automatic payouts.

Call `prepare(ctx, { accountId, ownerKey, operationKey, expectedRevision, mode:
"custom", thresholds: [{ currency: "usd", amount: 1000 }], consent: true })` in
an authorized action. Revision `-1` means no existing policy. Persisted preparation
captures the original payout schedule and country holding deadline before any
provider update. If preparation returns `prepared`, call `apply` with the same
account, owner and operation key. Replays preserve the immutable request;
competing operations and stale revisions are rejected. A provider timeout or
failed confirmation stays pending for reconciliation, rather than being treated
as a completed schedule change.

These APIs currently require a verified `dashboard: none` account and enabled
payouts for custom activation. Accounts with Dashboard withdrawal access return
an explicit control limitation: restricting schedule edits alone cannot prevent
manual withdrawals. The API never changes dashboard access or loss liability to
obtain control. Stripe also validates update permissions. Before each subsequent
payout attempt, `verify` must confirm live manual settings, unchanged country,
and an unexpired policy; stored `ready` state alone is insufficient.

Initial activation rejects existing nonzero available or pending balances,
in-flight payouts, and existing manual schedules with `migration_required`.
The preflight is repeated before an initial schedule update; a delayed activation
with newly arrived funds is canceled before changing Stripe. This is a bounded
preflight, not an ownership inference or automatic adoption.
Already-mixed funds need a reconciled source ledger and explicit adoption before
custom release can be enabled. Zero-balance activation does not classify later
unrelated deposits as earnings. Payout claims must use that source ledger and a
fresh provider balance when the separate release boundary is integrated.

The host must schedule a recurring server job that pages `due(ctx,
{ cursor: null, numItems: 100 })`, follows its cursor, and calls `expire` for each
returned account/owner. `expire` reconciles pending operations and restores the
original automatic schedule when the holding deadline is reached. Unattempted
expired enables are canceled without changing Stripe. Failed/unknown restores
remain visible and retryable; alert operators if they cannot complete. Editing
thresholds never extends the original deadline. Current limits are 10 days for
Thailand, a conservative 730 days for the US, and 90 days elsewhere; verify
current provider rules before enabling the feature in production.

For opt-out, prepare a new operation with the latest revision,
`mode: "stripe_managed"`, and `thresholds: []`, then apply it. Restoration remains
available after Dashboard control is lost, subject to Stripe permissions. It
restores only the captured schedule; other balance settings remain untouched.

This is the durable policy/control boundary. Automatic combined payout execution,
adoption of existing balances, and its UI integration are separate work and are
not supplied by these schedule APIs. Do not expose a custom minimum as fully
enforced until those boundaries and the recurring expiry job are installed.
`verify.providerMinimum` is `null`: the Balance Settings API does not expose a
numeric payout-floor field, and retained balance reserves are not payout triggers.

Sources: [payout schedules](https://docs.stripe.com/connect/manage-payout-schedule),
[manual payout holding limits](https://docs.stripe.com/connect/manual-payouts), and
[Dashboard control limits](https://docs.stripe.com/connect/platform-controls-for-stripe-dashboard-accounts#control-payout-timing).

### Transactional claim ledger implementation status

The component contains `payoutRelease` claim and source-allocation tables. These
are server-side building blocks for the release boundary, with no automatic
payout-creation or scheduled bank-payout integration yet. Do not call the claim
mutation with UI totals or a transfer receipt alone. Its trusted upstream caller
must establish complete provider history, still-unpaid ownership, adoption of
prior payouts, independent liabilities, and live payout controls first.

A claim combines mature creator and affiliate entitlement within one currency.
It deducts persisted paid and reserved allocations, keeps negative entitlement
after refunds, and caps the allocation by provider availability after independent
liabilities. Sources and policy revision are checked transactionally. One
unresolved account claim blocks competing reservations. An attempted claim
cannot be canceled merely because the provider timed out. Accepted payouts keep
their allocations reserved until payment is confirmed; a failed or canceled
payout releases allocations only after its provider return transaction has been
verified upstream. Return receipt identities cannot be reused across claims. A verified create
rejection for insufficient balance or an amount below the provider floor can
release an unaccepted claim within a conservative 23-hour window. It requires
its own unique Stripe request receipt; ambiguous errors and older attempts stay
held. This window stays below Stripe's [24-hour v1 idempotency retention minimum](https://docs.stripe.com/api/idempotent_requests).

The current claim snapshot is deliberately bounded to 100 account transfer rows
and 1,000 receipt IDs per source. Larger or incomplete histories reject the whole
claim, without using partial totals. A resumable reconciliation/adoption process,
provider payout creation and receipt verification, historical fee adoption, other account debit allocation, and
recurring release/expiry integration remain required before custom payout
minimums can be presented as an operational feature. In-memory claim tests are
not evidence of a completed Stripe bank payout.

## Verified recipient funding receipts

Use `stripe.payoutPolicy.transferReceipt(ctx, { accountId, stripeTransferId })`
in an authorized action to read a transfer's actual recipient funding. The
reader binds the component ledger to the provider transfer, destination payment,
original balance transaction and each transfer reversal's recipient refund.
It verifies account, amount, currency and source identities, and rechecks the
transfer and ledger before publishing a result. It performs no financial writes.

A `ready` result contains exact signed recipient settlement transactions and
`totalNet`, `matureNet`, and `pendingCredits`. `sourceCurrency` describes the
original transfer; `settlementCurrency` describes the actual recipient balance.
For supported FX receipts, amounts come directly from Stripe's settlement
transactions; the reader does not calculate exchange-rate conversions. Mixed
settlement currencies or missing conversion evidence require explicit allocation.
Transaction `created` and `availableOn` values are Unix seconds; the snapshot's
`observedAt` is milliseconds.

Positive credits qualify as mature only when their provider status is available
and their availability date has passed. Pending debits first cancel the matching
pending original credit; uncovered pending debits reduce mature credit. Other
positive pending adjustments never qualify early. Signed mature debt is preserved.
For example, in one settlement currency's minor units:

| Original credit | Reversal/debit | Total net | Mature net | Pending credits |
| --------------- | -------------- | --------: | ---------: | --------------: |
| 1000 pending    | 250 pending    |       750 |          0 |             750 |
| 1000 available  | 250 pending    |       750 |        750 |               0 |
| 1000 pending    | 1000 pending   |         0 |          0 |               0 |
| 1000 pending    | 250 available  |       750 |       -250 |            1000 |

This is **received credit, not still-unpaid entitlement**. Previous bank payouts,
source allocations, recovery liabilities and outstanding reservations must be
reconciled before any release. Do not pay `matureNet` directly or infer ownership
from unrelated account-wide available funds. Stripe's balance-transaction
`payout` filter maps automatic payouts only; application-created manual payouts
need a maintained allocation ledger.

The default budget is 20 provider requests; `maxRequests` accepts 1–100. Exhausted
or incomplete history returns `not_ready` without partial financial totals.
Reserved reversal claims, changing provider/ledger snapshots and unavailable
receipts also fail closed. Identity mismatches and invalid financial arithmetic
throw. Larger histories need continued reconciliation rather than treating the
missing amount as zero or silently truncating it. The original transfer ledger
remains intact for retries.

Sources: [transfer provenance](https://docs.stripe.com/api/transfers/object),
[receipt maturity](https://docs.stripe.com/api/balance_transactions/object), and
[history pagination and payout-filter limits](https://docs.stripe.com/api/balance_transactions/list).

## Verified payout receipts and reconciliation

In an authorized server action, read a Connect Stripe-balance payout with:

```ts
const receipt = await stripe.payoutPolicy.payoutReceipt({
  accountId,
  stripePayoutId,
});
```

The reader retrieves the payout and its actual account-scoped balance
transactions, including a failed/canceled payout's return transaction. It checks
transaction identity, currency, exact principal, signed fees, net amounts and
maturity, then re-reads the payout to detect changes. Expanded transaction
objects are not trusted in place of scoped retrieval. Automatic and manual
history can both be inspected; a manual payout receipt does not identify the
transfers that funded it. Changed snapshots, missing debit/return receipts,
pending debits or returns, unsupported currency allocation and bank-payout reversals return
`not_ready` without partial financial totals.

A ready receipt preserves `providerStatus`, original `debit`, optional returned
`credit`, `returnedPrincipal` and `returnedNet`. A returned principal can differ
from net cash because payout fees are retained or credited separately. This data
alone does not authorize releasing a reservation, identify still-unpaid earnings,
or prove that a pending payout reached the bank. Global Payouts requires a
separate receipt and capability implementation.

To reconcile an already attempted durable claim:

```ts
const outcome = await stripe.payoutPolicy.reconcilePayout(ctx, {
  accountId,
  ownerKey,
  operationKey,
  // stripePayoutId, // optional when the provider ID is already known
  maxPages: 10,
});
```

The host authenticates the account/owner/operation before this call. Reconciliation
requires `ctx.runMutation`. It never creates or retries a bank payout. A stored
provider ID must agree with any supplied ID. Otherwise, bounded provider history
is scanned for the exact reserved `bsPayoutClaim` marker. Discovery must finish;
partial history, duplicate matches and a changed history head stay held. The
page budget is 1 to 100, default 10. No match, including after idempotency expiry,
never proves that money did not move.

Adoption verifies the claim marker, amount, currency, creation window and
standard manual bank-payout type. Current claims use the card source balance;
other source rails return an explicit allocation limitation. A missing or
immature return keeps allocations reserved. Verified paid and returned outcomes
update source allocations and payout fees in one component transaction. Unknown
provider and persistence errors propagate so the host can retry reconciliation.
Canceled/rejected claim states are returned as terminal states, not as bank
payment confirmation.

Net non-refundable payout fees are retained per recipient/currency and deducted
from later mature unpaid entitlement. They are not deducted again from fresh
provider availability, which already reflects the debit. A newly observed fee
invalidates an unattempted claim prepared against an older fee revision. Fee
credits after a return reduce only the verified original fee; excess credits
require explicit allocation. Original debit receipts and their fees remain
immutable. Older returned claims can receive verified fee evidence without
releasing their principal again.

These receipt APIs reconcile existing claims. Use the release API below for
qualification and creation; receipt reconciliation by itself does not enforce a
minimum.

## Combined recipient release

After authorized custom policy activation, a host scheduled action can call:

```ts
const result = await stripe.payoutPolicy.release(ctx, {
  accountId,
  ownerKey,
  operationKey, // stable unique identity for this scheduled operation
  currency: "usd",
  independentLiabilities, // authorized outstanding off-provider debts/reserves
  maxPages: 10,
});
```

Authenticate the recipient and policy, and read all known off-provider debts and
reserves before invoking this server-only method. Never pass an untrusted client
amount or assume that an omitted debt is zero. Provider source refunds and payout
fees are already reconciled by the package and must not be counted again in
`independentLiabilities`. The host must install the recurring release and expiry
jobs before offering custom scheduling. This method does not install a cron.

The package verifies live manual schedule controls, reads every account source,
retrieves transfer and payout receipts, and compares the complete settlement
currency balance history with those verified receipts. Unknown credits, refunds,
fees and prior payouts return `held/unallocated_history`. A current balance is
never treated as proof of unpaid ownership. History must reconcile to the live
available and pending balance; changing or incomplete snapshots stay held.

Mature unpaid creator and affiliate sources qualify together in integer minor
units. Pending credits do not qualify. Outstanding source reservations, prior
paid allocations, actual refunds, payout fees and supplied independent liabilities
reduce eligibility. The cap uses the available card-source balance, since the
immutable provider request explicitly selects `source_type: "card"` and a
standard bank payout. Other rails and currencies cannot increase that cap.

A qualifying operation reserves its exact source allocations in a component
transaction, verifies live controls again, and records the attempted marker before
calling Stripe. The provider idempotency key and request are fixed by the durable
claim. Concurrent callers therefore share one financial operation. Subsequent
calls to an attempted operation only reconcile provider receipts, including when
the original call timed out. They never blindly recreate an unidentified payout.
A verified no-object `balance_insufficient` or `amount_too_small` rejection releases
reservations; unknown errors keep them held. An interrupted unattempted operation
is canceled on replay, and a new scheduled operation can collect fresh receipts.
Below-threshold money remains owed. The numeric provider floor remains `null`
unless a supported provider contract exposes it.

Current atomic collection accepts up to 100 account transfers and 100 historical
claims. Larger accounts return `held/snapshot_limit`, without paying a partial
page. Provider history uses a 1–100 page budget, default 10; exhaustion stays held.
Explicit prior-payout/source adoption, resumable larger-account collection,
independent provider-debit allocation, recurring example jobs and React controls
remain integration work. Existing funded accounts still follow the policy
migration safeguards; do not bypass `migration_required` to activate this API.

Sources: [payout creation and source balance selection](https://docs.stripe.com/api/payouts/create),
[complete balance history and automatic-only payout filtering](https://docs.stripe.com/api/balance_transactions/list).
