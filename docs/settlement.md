# Verified settlement and recipient payouts

BetterStripe owns provider reads, immutable settlement claims, transfer execution,
and recovery. Your server authenticates the caller, resolves recipient accounts,
selects rates, and authorizes the allocation. Never accept these values directly
from a browser. Amounts below are integer minor units in one currency.

## Resolve original payment provenance

Use `getVerifiedPaymentSource` when the host has an authorized PaymentIntent and
needs its original invoice price for settlement or processing-cost recovery:

```ts
const source = await stripe.getVerifiedPaymentSource(ctx, {
  paymentIntentId,
  customerAccountId, // Optional expected binding; authorize this in your host.
  stripeAccountId, // Optional connected-account execution scope.
  gross: expectedGross,
  currency: expectedCurrency,
  maxHistoryPages: 5,
  maxHistoryItems: 500,
});
if (source.status !== "ready") return source;
// Authorize source.value.stripeProductId before applying application policy.
```

The read-only result contains provider IDs, original gross and processing fee,
currency and live/test mode. Optional expected `invoiceId` and `subscriptionId`
are also checked. Provider reads inherit the SDK's configured Stripe API version
and connected-account scope. Authentication, seller/product ownership, metadata
interpretation, commission and retry scheduling remain host responsibilities.

Resolution requires complete inverse PaymentIntent funding history, complete
invoice funding history, one fully paid PaymentIntent allocation and one original
priced invoice line. It verifies customer, invoice, subscription, charge and
balance-transaction bindings, currencies and reconciled gross/fee/net amounts.
Current subscription items and metadata never establish the original price.
Prorations, partial/credit/multiple-payment funding and ambiguous price allocation
are rejected instead of guessed. Refunded or disputed charges retain their
original provenance; a ready source does **not** establish settlement eligibility
or calculate subsequent refund/dispute costs.

Each of the three history walks has independent validated limits: 1–20 pages and
1–2,000 items (defaults 5 and 500), at most 100 items per page. Reaching a limit
before `has_more: false`, malformed pages, repeated IDs or failed history reads
returns `unknown/history_incomplete`, with `retryable: false`. Missing processing
fees return `not_ready/fee_pending`; only a provider-verified zero fee becomes
zero. Identity conflicts and unsupported sources are terminal typed outcomes.
Other failed provider reads return sanitized `unknown/provider_outcome_unknown`.
The method performs no writes or automatic financial-operation retries.

`getVerifiedSale` and the existing cost readers keep their existing contracts,
including settlement eligibility checks. The new resolver shares their pure
currency/amount and single-funding checks without changing their result shapes.

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

### Reauthorize before financial dispatch

`settleSale` accepts an optional **server-only** `authorize` callback. Existing
callers without it retain their behavior. Authenticate the actor and derive the
original purchase, community, charge and recipient scope on your server first;
then use the callback to re-read current authorization rather than trusting
browser account IDs or provider metadata:

```ts
await stripe.settleSale(ctx, {
  ...originalSettlement,
  authorize: async (context) => {
    // Application-owned check: current actor, original purchase/source and recipients.
    await authorizeOriginalSale(context);
  },
});
```

The discriminated `SettlementAuthorizationContext` has two phases:

- `reserve`: after provider sale reads and before allocation admission. On replay,
  the snapshot contains the prior immutable allocation when one exists.
- `transfer`: after provider transfer reconciliation and immediately before each
  **new** transfer POST. It contains the actual saved source/economics and the
  effective leg, including a reduced affiliate release after package-owned debt
  offsets. A competing reservation cannot substitute an unexamined recipient.

Snapshots are detached from engine inputs; callback mutation cannot change the
claim or transfer. Throwing from a direct `settleSale` callback propagates the
host error and prevents that write; the SDK does not retry it. The callback does
not return replacement economics or establish original cash provenance.

The last check and Stripe are not a distributed transaction. A later denial can
leave an admitted immutable allocation or earlier successful legs in place;
partial success is not undone. Retrying reuses the original claim and still
checks each missing new leg. Already-recovered provider success can be persisted
without another `transfer` callback or another POST: it is reconciliation of
money already moved, not new financial dispatch. `onSettled` remains a
post-execution, replayable completion callback, not an authorization check.

The active Vite adapter uses fresh original-sale and current seller-mapping
queries; demo metadata is not a production authorization policy. For its actual
sealed recovery-group path, pass the same server-only callback in the runtime
options to `costRecovery.executeGroupProvider`. This path already has persisted
group/allocation admission and dispatch: it invokes only the final `transfer`
phase for each new settlement transfer, not an earlier `reserve` guarantee.
The existing snapshot/definition/phase checks still apply. Reconciliation-only
work never creates a missing transfer or invokes a new-money callback.

A recovery callback rejection uses the existing conservative `unknown` hold
receipt and does not automatically retry or complete the group. This is the
workflow's disposition of a denied dispatch, **not** an observed unknown Stripe
cash result or provider failure. Original group/allocation state and earlier
success remain retained. No callback, credential or authority flag is persisted
in workflow arguments; supply it inside the registered internal host action.

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
`pnpm exec convex run marketplace/commissionMigration/mutations:run '{}'` from `example/`. Repeat until
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

For a custom threshold, BetterStripe holds funds in the recipient's Stripe
balance and controls the bank-payout schedule. Verified manual controls and a
host automatic job prevent provider sweeps from bypassing the threshold. A
retained reserve cannot serve as the trigger.

Manual holding limits depend on country: Thailand 10 days, US 2 years, other
countries generally 90 days. Schedule permissions depend on account controls and
liability. Negative balances, refunds, and in-flight payouts must reduce any
release amount; source-category thresholds and currency netting are unsafe.
See [payout schedule permissions](https://docs.stripe.com/connect/manage-payout-schedule)
and [manual payout restrictions](https://docs.stripe.com/connect/manual-payouts).

Custom threshold enforcement is not provided by the snapshot or settlement APIs.
Use the recipient-held policy, adoption and release APIs below. Applications must
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

Ordinary initial activation requires zero available/pending balances, no past or
in-flight payouts, and an automatic schedule. Existing balances, payout history
or a manual schedule return `migration_required`. The ordinary preflight repeats
before a delayed initial write. For an owned funded account, use the explicit
[historical import and funded activation flow](#historical-import-and-funded-activation)
below. Unknown money is never classified as earnings merely because it is
available. Existing manual schedules still require an authorized migration to a
known automatic schedule before custom activation; the package does not guess
which schedule should be restored later.

The host must schedule a recurring server job that pages `due(ctx,
{ cursor: null, numItems: 100 })`, follows its cursor, and calls `expire` for each
returned account/owner. `expire` reconciles pending operations and restores the
original automatic schedule when the holding deadline is reached. Unattempted
expired enables are canceled without changing Stripe. Failed/unknown restores
remain visible and retryable; alert operators if they cannot complete. Editing
thresholds never extends the original deadline. Current limits are 10 days for
Thailand, a conservative 730 days for the US, and 90 days elsewhere; verify
current provider rules before enabling the feature in production.

During the final 24 hours before the persisted holding deadline, combined release
waives the optional application minimum. It still verifies source maturity,
unpaid allocations, live Stripe balance, liabilities, reservations, schedule
control and provider payout constraints. The one-minor-unit positive amount
guard is not a claimed Stripe payout floor. The configured minimum and original
deadline remain unchanged. Preview includes `minimumWaived` and `holdDeadline`
so hosts can explain eligibility below the saved minimum.

Worker attempts are due at the start of this final window even if an older job
had a later daily cadence. Within the window, retries are scheduled no more than
five minutes apart. Hosts must invoke discovery at least that often; stored
attempt times do not execute themselves. Unknown outcomes retain the same claim
for reconciliation. A provider floor rejection remains explicit and does not
consume entitlement.

Restoring a weekly/monthly schedule at expiry is a control fallback, not proof
of funded disbursement within the country holding window. Monitor approaching
deadlines and escalate provider failures, unavailable bank destinations,
unreconciled history and unresolved claims before expiry. After restoration, `expire` separately observes fresh provider balances and checks
reserved/submitted payout claims under the component transaction. It returns
`expiry_unresolved` while a balance or claim remains, or when balance verification
is unavailable. `policy.holdingExpiry` preserves the original deadline, recovery
status and last observed balances per currency. These are provider balances,
not a payable earnings assessment; pending and negative amounts are not netted
across currencies.

An unresolved expiry retains `holdDeadline` even in `stripe_managed` mode so the
same `due()`/`expire()` loop continues recovery checks. Custom reactivation and
example reset cannot erase that record. Once a fresh observation has zero
available and pending balances in every currency and no reserved/submitted
claim remains, discovery clears the deadline and retains a `no_held_balance`
observation. That means no balance was held at the observation time, not that a
bank payout arrived or that off-provider obligations were forgiven.

Existing active policies gain the recovery record at their first due expiry
under the updated SDK. Already-restored older policies whose deadline was
removed are not automatically backfilled. Audit their historical policy
operations and Stripe receipts before treating them as financially settled;
absence of a recovery field does not prove disbursement.

Alert operators on `expiry_unresolved`. Reconcile unknown payout outcomes through
the existing worker or receipt APIs using their original operation identity;
never delete claims or blindly create replacements. Resolve provider capability,
bank destination and floor failures through supported Stripe configuration.
Do not add platform funds to cover a recipient shortfall. Continue the expiry
loop after resolving the cause so fresh observations can close recovery.
A provider balance read failure does not prevent schedule restoration and never
fabricates zero. Control-update failures preserve pending intent and remain
retryable. Do not claim a successful bank payout from a schedule update alone.

For opt-out, prepare a new operation with the latest revision,
`mode: "stripe_managed"`, and `thresholds: []`, then apply it. Restoration remains
available after Dashboard control is lost, subject to Stripe permissions. It
restores only the captured schedule; other balance settings remain untouched.

The policy/control APIs compose with historical adoption and combined release.
Install recurring release and expiry jobs before exposing custom scheduling.
React/example job integration and larger-account collection remain separate work.
`verify.providerMinimum` is `null`: the Balance Settings API does not expose a
numeric payout-floor field, and retained balance reserves are not payout triggers.

Sources: [payout schedules](https://docs.stripe.com/connect/manage-payout-schedule),
[manual payout holding limits](https://docs.stripe.com/connect/manual-payouts), and
[Dashboard control limits](https://docs.stripe.com/connect/platform-controls-for-stripe-dashboard-accounts#control-payout-timing).

### Transactional source allocations

The package release method owns provider verification and payout creation over
`payoutRelease` claim and source-allocation tables. Use that method rather than
calling trusted component mutations with UI totals or an isolated transfer
receipt. Complete provider history, still-unpaid ownership, prior payouts,
independent liabilities and live controls must be established together.

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

The legacy direct snapshot supports 100 account transfers and historical claims.
Public release, preview and historical-adoption flows switch to complete paginated
collections beyond that boundary. The per-source observation guard still permits
at most 1,000 receipt IDs; incomplete provider history never supplies partial
financial totals. Native platform limits still apply to the atomic boundary.
Hosts install the scheduled runner and authenticated UI adapters. Unknown provider
debits need explicit accounting before qualification. Verify actual Stripe payout
receipts rather than treating component-only tests as proof of bank payment.

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
standard bank payout. The complete bank-account listing must identify one
default bank for the settlement currency. Its ID is persisted with the claim,
passed explicitly to Stripe, and checked again in the payout receipt. Other rails and currencies cannot increase that cap.

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

The direct component snapshot remains bounded at 100 source/claim rows. The SDK
switches to a complete paginated manifest above that boundary and binds its
verified membership to the financial claim. It never pays from a partial page.
Provider history uses a 1–100 page budget, default 10; exhaustion stays held.
Use the separate historical import and funded activation contract below for known
old funds; a local manifest is not historical-adoption proof. Unknown funds and
unsupported accounts keep explicit migration holds.

Sources: [payout creation and source balance selection](https://docs.stripe.com/api/payouts/create),
[complete balance history and automatic-only payout filtering](https://docs.stripe.com/api/balance_transactions/list).

## Historical import and funded activation

The host authenticates one recipient account and owner, authorizes historical
source mappings, and records consent before custom scheduling. Start with an
owned `stripe_managed` policy at its current revision. If no policy exists,
prepare/apply a default policy with `expectedRevision: -1`,
`mode: "stripe_managed"`, and `thresholds: []`. This records ownership and keeps
the current automatic schedule.

Import past payouts whose allocations are not already recorded by BetterStripe:

```ts
const imported = await stripe.payoutPolicy.adoptPayouts(ctx, {
  accountId,
  ownerKey,
  expectedRevision: policy.revision,
  currency: "usd",
  payouts: [
    {
      stripePayoutId: historicalPayoutId,
      allocations: [
        { stripeTransferId: creatorTransferId, amount: 600 },
        { stripeTransferId: affiliateTransferId, amount: 400 },
      ],
    },
  ],
});
```

Amounts use integer settlement-currency minor units. The package does not infer
manual-payout ownership from a present balance or Stripe's automatic-only payout
filter. Supply authorized accounting for every unrecorded historical payout in
the currency. Existing package claims supply their immutable allocations on
subsequent calls; use `payouts: []` to verify/reconcile already imported history.
The same flow supports explicit accounting for automatic historical payouts.

For a verified bank return, holding-age proof retains the original paid
principal and adds the returned credit at its availability time. The returned
claim contributes no currently paid source allocation. Net provider fees still
reduce the combined unpaid balance. Replaying adoption preserves the same claim;
a later release can include returned cash and new funding exactly once.

The package retrieves actual recipient funding and payout receipts, verifies
full history against live available/pending cash, and validates each allocation
against source maturity at the historical payout date. Future credits and
not-yet-mature bank returns cannot fund an earlier payout. Terminal paid and
verified returned payouts are supported; pending or ambiguous outcomes stay
held. Unknown credits, debits, fees or unallocated payouts require further
reconciliation. All unknown historical payouts import as one component
transaction, including fees and source allocations. Each new historical claim
retains immutable observations for every allocated source. Unrelated source
proofs are still checked in the complete batch, but are not copied onto every
claim. Existing claim evidence is not rewritten. Changed mappings and stale
competing snapshots reject without mixing their writes. Replays never create a
payout. Historical paid principal remains paid after later refunds, so debt
reduces later qualifying funds rather than making the old commission payable
again. An adopted payout can reconcile a subsequent bank failure without
requiring a package marker that was absent from its original Stripe object.

Historical receipt reads are bounded to five concurrent requests. Known outcomes
reconcile in atomic batches of at most 25, splitting repeated allocation work
above 1,000 allocations while retaining a large individual outcome as its own
transaction. Native per-transaction limits still apply. Batches use the same receipt, ownership, fee,
uniqueness and return validation as individual reconciliation. An invalid row
rolls back its entire batch; earlier verified batches remain safely retryable.
Disposable source caches retain optional primary document IDs to avoid repeated
indexed lookups. Older caches fall back to indexed reads, and every primary-ID
lookup still checks live identity and financial state. Already-read transfer
baselines never replace the final live ledger check.

Identical activation callers can complete while another caller is verifying a
proof or waiting to mark its attempt. These retry boundaries re-read the same
owned durable operation. Attempted, completed or canceled operations resume
through their canonical state; an unattempted proof failure still rejects.
A committed attempt is not marked again after its response is lost. Original
provider request identity and schedule-restoration records remain unchanged.

Public adoption and funded activation use complete cursor-paginated collections
when local sources, existing claims or proposed imports exceed the small direct
snapshot path. There is no lifetime 100-row cutoff in these public flows. The
collection checks complete membership, paid/reserved rollups, owner, policy and
financial revision again inside the atomic import or activation transaction.
Unlike a later release, adoption rejects deferred positive funding as well as
risk changes; collect a new current baseline before changing account controls.

`collection_pending` preserves bounded local work. Repeat the same authorized
account/currency/policy request with enough `maxPages` to complete the provider
history. The internal collection key also includes the policy operation, so a
new policy operation cannot reuse an obsolete baseline. Invalidated and consumed
read-only caches are discarded; financial claims and schedule restoration records
remain intact. No partial import or cache state authorizes a bank payout.

Source receipts run in groups of at most five. After reconciliation, a complete
matching currency history renews its observations. Funded activation verifies
every discovered currency, then rechecks the account-wide balance and history
head after collecting the local baseline. It renews the complete proof only if
that provider snapshot remained unchanged. These checks retain freshness limits
rather than accepting old observations because a scan took longer.

Native platform limits still apply to the atomic boundary, including document,
argument, return-value and transaction sizes, array lengths and execution time.
An oversized workload requires a separately designed import/migration; it must
not be split into unverified partial activation or silently truncated. See the
[Convex limits](https://docs.convex.dev/production/state/limits). Provider page
budgets and unsupported payout rails remain explicit holds.

After successful import, explicitly request funded-account adoption during
preparation, using the latest owned policy revision:

```ts
const prepared = await stripe.payoutPolicy.prepare(ctx, {
  accountId,
  ownerKey,
  operationKey,
  expectedRevision: policy.revision,
  mode: "custom",
  thresholds: [{ currency: "usd", amount: 1000 }],
  consent: true,
  adoptExistingBalance: true,
});
if (prepared.status === "prepared") {
  await stripe.payoutPolicy.apply(ctx, { accountId, ownerKey, operationKey });
}
```

Preparation verifies all settlement currencies, full source membership and prior
payouts. It repeats provider-history and balance checks before a delayed initial
attempt, then checks local financial fingerprints under OCC before recording
the attempt marker. New unallocated history cancels an unattempted activation
while preserving the automatic schedule. Refresh the policy revision and use a
new operation key after cancellation. If a manual schedule appears without the
package's attempt marker, the operation reports schedule drift rather than
pretending the package performed the change. Provider timeouts retain the
persisted attempt and immutable schedule request for reconciliation.

Holding age follows the unpaid funds. Paid original credits do not age newer
funds; source debt and verified payout fees consume older ownership first.
Verified bank-return cash starts a new holding age when it becomes available.
Preparation cannot restart an expired holding period, and later checks can only
shorten the pending operation's deadline. `migration_required.adoptionReason`
explains unknown history or an expired holding period. This flow does not enable
Dashboard accounts with withdrawal bypasses, Global Payouts, unsupported source
rails, unknown numeric provider floors or workloads beyond native atomic
platform limits. Activation itself does not install a host cron or UI.

## Automatic recipient worker

`stripe.payoutPolicy.worker` runs authorized custom policies from a host cron.
It invokes the maintained release and reconciliation APIs, including their live
schedule, source-maturity, history, fee and balance checks. A worker lease never
replaces the financial payout claim.

```ts
const result = await stripe.payoutPolicy.worker.run(ctx, {
  accountId,
  ownerKey,
  currency,
  // Resolve all off-provider debts and reserves for this owner/currency first.
  // Do not count Stripe receipt debits twice.
  independentLiabilities,
  cadenceMs: 300_000,
});
const job = await stripe.payoutPolicy.worker.get(ctx, {
  accountId,
  ownerKey,
  currency,
});
// job.nextAttemptAt is the next application attempt, not a bank arrival date.
```

The default retry cadence is five minutes; hosts can configure one minute to
one day. Concurrent callers share a ten-minute lease. A crashed worker resumes
the same operation ID. Unknown provider outcomes retain their attempted claim
and reconcile on later runs, including after a recipient opts out. They never
trigger a blind payout recreation. Expired worker leases permit observation
retries; they do not release monetary reservations. A generation check prevents
an older worker from replacing a newer worker's result. Completion replays keep
the original next attempt time.

Affiliate clawback debt, pending recoveries/restorations and competing affiliate
payout reservations hold fresh worker attempts with `affiliate_recovery_pending`.
The recipient claim boundary checks the same recovery lock again atomically
before reservation and immediately before the provider attempt. Existing unknown
attempts continue to reconcile even when new recovery debt arrives. Do not add
the same affiliate debt to `independentLiabilities` again; that option is for
separate host liabilities.

The host must page all four queues, using bounded pages and scheduling each
recipient/currency independently:

- `worker.policies(ctx, paginationOpts)` discovers ready custom policies.
- `worker.recovering(ctx, paginationOpts)` discovers retained operations,
  including recipients who switched back to Stripe-managed payouts.
- `worker.changing(ctx, paginationOpts)` discovers pending schedule operations
  to retry through `payoutPolicy.apply`.
- `payoutPolicy.due(ctx, paginationOpts)` discovers expired holding deadlines
  to restore through `payoutPolicy.expire`.

Authorize the host's owner/account mapping before each action. Read outstanding
liabilities again before every attempt. In the example, uncollected seller cost
reservations remain withheld even while attached to an unpaid invoice. Confirmed
collections are already reflected in the store's transferred amount. Additional
host liability scopes must be included when adopting this worker in another app.

The example's `convex/crons.ts` installs a five-minute dispatcher. Its internal
actions in `convex/payoutWorkers.ts` page these queues and use the package APIs;
they do not call the Stripe SDK directly. Stripe-managed recipients continue to
use Stripe's automatic schedule. Custom activation still requires explicit
consent and verified exclusive payout control. The worker preserves the current
release/adoption history limits and reports held results when those limits are
exceeded. It does not yet consume the resumable local manifest described below.

These are server worker APIs, not manual withdrawal actions for a customer UI.
`worker.get` exposes the latest reason, attempt time and next application attempt
for an authorized host to display. Bank availability, pending funds and bank
arrival dates come from the recipient payout snapshot API.

## Payout eligibility preview

An authorized server action can assess a custom policy before displaying its
progress. It uses the same provider receipt qualification and local allocation
plan as release:

```ts
const preview = await stripe.payoutPolicy.preview(ctx, {
  accountId,
  ownerKey,
  currency,
  independentLiabilities,
});
const job = await stripe.payoutPolicy.worker.get(ctx, {
  accountId,
  ownerKey,
  currency,
});
```

Authorize the owner/account mapping and derive independent liabilities on the
server, exactly as for the automatic worker. The preview reads Stripe and can
reconcile existing payout receipts in the component. It never creates a bank
payout, reserves funds, or invokes the worker. The caller needs an action context
that permits component queries and reconciliation mutations.

A detailed result includes `currency`, `threshold`, `matureUnpaid`,
`pendingCredits`, `confirmedFees`, `independentLiabilities`, `providerAvailable`,
`amount`, `observedAt` and `sources`. Each source category reports its signed
mature unpaid entitlement and pending credits. Category amounts are before shared
fees and independent liabilities. Those deductions reduce the combined
`matureUnpaid` once. Negative entitlement after a refund survives the calculation;
pending credits never qualify. `amount` is the amount currently qualified for the
supported bank payout rail, or zero when held. `providerMinimum: null` means the
numeric Stripe floor is unknown, not zero.

Detailed assessments also include an optional `accounting` object, in the
selected currency's minor units:

| Field                  | Meaning                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `carriedForwardAmount` | Positive combined mature unpaid entitlement minus the amount eligible now. Held funds remain owed.                       |
| `withheldAmount`       | Mature unpaid funds earmarked for confirmed fees and independent liabilities, capped at the funds available to withhold. |
| `reservedAmount`       | Source allocations reserved for in-flight payouts. These are separate from completed payouts.                            |
| `releasedAmount`       | Verified paid principal, less verified payout returns.                                                                   |

Each source category also includes `reservedAmount` and `releasedAmount`.
The component checks source allocation rollups against persisted payout claims
before reporting these amounts or reserving a new payout. Inconsistent or
incomplete claim history rejects the assessment. Shared costs are not assigned
to individual source categories. A refund after a completed bank payout reduces
future entitlement; it does not erase the paid principal unless Stripe verifies
that the bank payout itself returned. Full outstanding obligations remain in
`independentLiabilities` even when funds available to withhold are smaller.

Older detailed results can omit `accounting` and the source payout fields.
Treat omitted fields as unavailable, never as zero. Minimal held results do not
include accounting totals.

Below-threshold funds remain owed. `insufficient_available` distinguishes enough
qualifying earnings from insufficient provider funds on the supported rail. Some
holds return only `{ status: "held", reason, amount: 0 }`, including incomplete
history, unverified controls and unresolved affiliate recovery. Such a result
does **not** establish a zero balance or zero debt. Render an unavailable
assessment with its reason, rather than inventing amounts. Ledger changes during
the final query reject the assessment and require a refresh.

The preview verifies policy controls again after reading provider data. Source
and balance observations for the selected currency older than 30 seconds do not
qualify. A complete provider-history check renews that currency's source
verification time only after all independently fetched receipt fingerprints,
current balance and stable history head match. Partial, changed, missing or
unallocated history never renews it. This lets slower receipt scans finish
without relaxing freshness; local ownership, membership, reversal and reservation
checks still run atomically afterward. Other currencies keep their original
observation times and cannot increase or block this currency's assessment merely
because their receipt observations are older. Display
`observedAt` as an assessment time; release independently repeats qualification
and reserves funds atomically. A qualified preview is neither a promised payout
nor authorization to call Stripe. `job.nextAttemptAt` is the next application
attempt. Bank arrival dates remain separate provider data from
`getPayoutSnapshot`.

Stripe-managed recipients keep Stripe's default automatic schedule. This preview
requires a ready custom policy, verified complete provider history, the supported
region/control capabilities and payout rail. The SDK automatically collects a
paginated local manifest when the small direct snapshot exceeds 100 rows; a
partial collection never supplies an eligibility amount.

## Resumable local collections

Worker discovery, policy expiry, pending affiliate reconciliation, seller cost
history and local collection pages use the component-compatible paginator from
`convex-helpers`. Convex's native database `.paginate()` is unavailable inside
components. The public page shape remains `page`, `continueCursor` and `isDone`.
Treat cursors as opaque and restart cached pages at a null cursor when upgrading
these readers. Use the package's discard operation for an obsolete read-only
collection; never erase financially bound or unresolved payout state to restart
a scan. The automatic SDK qualification path uses these pages when a direct
snapshot exceeds 100 lifetime source or claim rows.

An authorized host worker can collect the local recipient ledger in bounded
steps, retaining its cursor and step number across restarts:

```ts
let state = await stripe.payoutPolicy.collectSnapshot(ctx, {
  accountId,
  ownerKey,
  operationKey: collectionKey,
  expectedRevision: policy?.revision ?? -1,
});
state = await stripe.payoutPolicy.collectSnapshot(ctx, {
  accountId,
  ownerKey,
  operationKey: collectionKey,
  expectedRevision: policy?.revision ?? -1,
  expectedStep: state.step,
  batchSize: 25,
});
```

Repeat bounded calls until `phase` reaches `local_ready` or `invalidated`.
Duplicate step submissions preserve cursor progress. Sources, source allocations,
payout fees and payout claims are copied across pages, with no 100-row limit on the local
collection. New positive funding can be deferred to a later collection; refunds,
reservations, payouts and fees enter an ordered account risk journal. The worker
repairs changed entries and checks claim/source allocation rollups before local
completion. Missing journal events, orphaned sources and changed policy identity
stop collection with an explicit reason.

`local_ready` describes a read-only local manifest. Complete provider receipts,
provider history and monetary claim binding are still required before a payout.
The SDK verifies every source against Stripe, fetching at most five source
receipts concurrently, and checks the complete selected-currency provider history.
The monetary transaction then checks the collection's owner, policy, full source
membership, allocation rollups and current risk revision. A qualifying collection
is bound to the immutable payout claim, including that claim's own reservation
writes. The risk revision is checked again before the provider attempt. A later
reversal, fee or competing claim cannot silently change the request.

`collection_pending` retains the recurring worker operation and resumes its local
cursor on a subsequent scheduled check. `collection_invalidated` requires a new
assessment. Preview/qualification on a query-only context returns
`collection_requires_action` for larger histories; use an authorized server action.
A bank payout is not created by collecting or previewing. Complete provider history
still has the caller's `maxPages` budget, and claims must fit Convex's argument,
transaction and document limits. Budget errors never erase financial records or
qualify a partial manifest; use operator recovery for an unsupported workload.

After a read-only collection is no longer needed, repeatedly call
`discardSnapshot(ctx, { accountId, ownerKey, operationKey: collectionKey })` until
it returns `null`. Cleanup removes only collection caches. Read-only collection
leases last 24 hours. Financially bound collections reject read-only cleanup and
expiry. Once an attempt is durably marked or an unattempted claim is canceled,
its cache becomes discardable; the claim retains its own immutable observations
and reservations. An unknown provider outcome keeps those reservations, even
when the disposable cache has been removed.

### Development reset safeguards

`clearAllTables` is a development/test utility. It rejects active or changing
payout schedules, unresolved reserved/submitted claims, financially bound
collections and known pending/in-transit provider payouts. The host must quiesce
provider writers and verify live provider state before invoking reset. Restore
schedules through the policy APIs and reconcile unresolved operations first.
Pending or unknown direct affiliate payouts and recovery operations also block
reset, preserving the receipts and obligations needed for reconciliation.
The guard preserves the restoration and payout records until that work is done.
Read-only cache collections can be cleared with the other development data.

### Observing automatic attempt outcomes

Worker jobs record `lastResultAt` with each completed check and retain a verified
Stripe rejection code in `lastReason`. `payoutAttemptStatus(job)` distinguishes
running, reconciling, rejected, failed, held and paid results. Active generations
take precedence over old successes; missing legacy result times remain unknown.
Use the exported `payoutAttemptValidator` for a host DTO and keep the operation's
immutable rejection receipt for audits. The example warns operators on rejected
payouts before the holding deadline, without logging raw provider errors.

A rejected request releases proven reservations; it does not forfeit unpaid
entitlement. Refunds/reversals still reduce qualifying funds. Provider floors
remain provider-enforced and numerically unknown when not exposed. Reassess fresh
receipts and balances on the next scheduled attempt rather than manually
recreating uncertain requests.

### Versioned recovery liabilities

Resolve seller refund/dispute costs and their account version in one component query:

```ts
const quote = await stripe.costRecovery.payoutQuote(ctx, {
  accountId,
  scopeKey: authorizedRecoveryScope,
  currency,
});
await stripe.payoutPolicy.worker.run(ctx, {
  accountId,
  ownerKey,
  currency,
  ...quote,
});
```

Use the same quote with `preview` or `release`. The amount is
`max(0, amountDue - collectedAmount)` for that authorized recovery scope;
invoice reservations remain owed until collection is verified. Provider-collected
costs are not deducted again. Keep the amount and `liabilityRevision` together,
for the same account, scope and currency. Use an authorized user-level scope
when costs span communities; the host remains responsible for including all
other authorized debts/reserves and for versioning state outside this component.
The package's revision does not version an external host database.

Recovery amount changes enter the payout risk journal. The financial boundary
rejects an old quote, and a bound claim checks the current risk revision again
before its attempt. Its own reservation writes are included in the binding.
A source/fee/recovery change requires a new assessment; unattempted reservations
are canceled exactly on replay. An attempted or unknown payout still reconciles
its immutable request. New claims retain the approved `independentLiabilities`
and `liabilityRevision` for audit.

Legacy unversioned calls remain valid for accounts without recovery balance
records. Once such records exist, obtain a quote; missing versions fail safely.
The example's worker and preview adapters do this automatically. Old unattempted
claims are canceled on replay, rather than retroactively supplied with a guessed
quote. Restart obsolete read-only collections after upgrading their fingerprint
format; never clear unresolved financial claims to bypass validation.

## Native metered and prepaid sales

Use the [usage settlement guide](usage-settlement.md) for original metered-invoice provenance and issuer-service paid-credit purchases. The usage facade reuses the existing allocation, transfer and recovery ledgers and keeps usage consumption separate from cash settlement.

## Immutable host policy context

`settleSale` accepts optional `allocation.policyContext`:

```ts
const policyContext = {
  namespace: "my-app.sale-policy",
  version: 1 as const,
  fields: { originalSale: saleId, planVersion: verifiedPlanVersion },
};
```

This nonsecret envelope is stored on the first component allocation and returned
by allocation reads and settlement results. It is opaque provenance, never SDK
permission or browser-supplied authority. The host must validate its original sale,
current roles, recipients and exact economics in `authorize` before money writes.
Namespace is 1–80 characters; at most 32 string fields have 1–64-character keys and
values of at most 512 characters. Keys also follow Convex object-field rules:
non-control ASCII, without a leading `$`. Canonical JSON is limited to 8 KiB UTF-8. Reordered
map keys replay identically. Changed context, including absent versus present,
rejects without replacing the saved allocation. Existing context-free callers
remain supported; a legacy allocation cannot acquire context on retry.

Resolve the current paid-tier policy only after verified positive cash is ready,
at the first reservation for that sale. Checkout creation, a trial or a zero invoice
does not freeze a future cash fee. On retry, authorize the original saved context
and immutable allocation rather than interpreting today's policy as historical
terms. This does not define recurring affiliate terms or supply a host money ledger.

The initial `reserve` callback receives the validated proposal before it is saved.
Resume admission receives the saved allocation; every new `transfer` callback
receives its actual saved context and effective leg, including legitimate affiliate
release reductions. Snapshots are detached, including nested context fields.
Recovery keeps its earlier group admission and runtime transfer-only callback;
operation/allocation context mismatch prevents a new transfer POST. No new recovery
admission callback or distributed atomicity is promised. Prior successful transfers
and reconciliation are retained when later authorization rejects.
