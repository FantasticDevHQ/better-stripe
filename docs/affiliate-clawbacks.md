# Affiliate commission clawbacks

Affiliate recovery extends the original Connect transfer ledger. It records
original commission economics, refund/dispute exposure, provider receipts,
unrecovered debt, future-commission offsets, and dispute-win restoration.
Seller processing and dispute-cost recovery remain separate.

## Accounting and overlap

Each commission has an `affiliateObligations` row with its original charge,
available store/payment/invoice references, recipient, currency, and allocated
commission. Percentage and fixed commissions use the actual original allocation,
not current payout rules. Each recurring invoice is independent. Refunds do not
reset one-time subscription commission eligibility.

Finalized refund principal is the sum of live Stripe refunds whose status is
`succeeded`. Pending, failed, canceled, and action-required refunds are excluded;
`charge.amount_refunded` alone can include pending refunds.

Refund and monetary-dispute exposure share an original-principal axis. The
combined commission target is the larger cumulative successful-refund or active
monetary-dispute exposure, capped at the original charge, multiplied by the
original commission and rounded half up using integer arithmetic. This is a
conservative overlap policy: independently disjoint portions of a charge would
need additional provider allocation evidence. Warning/inquiry and prevented
payloads do not create monetary recovery.

For example, a 1,001-unit commission on a 10,000-unit charge has a 501-unit
finalized obligation after a successful 5,000-unit refund. A full-charge dispute
raises the combined target to 1,001 units, including 500 provisional units. A win
leaves the independent 501-unit refund deducted. A lost dispute finalizes its
existing exposure without another debit. Persisted terminal states prevent old
opening events from reopening a won dispute.

Net recovery is confirmed reversals plus applied future-commission offsets minus
confirmed restorations. Outstanding debt is the positive difference between the
current target and net recovery. Restoration owed is the excess actually
recovered over the current target. Unrecovered dispute debt disappears on a win;
only actual reversals or offsets can become restoration owed.

## Provider operations and insufficient balance

`affiliateRecoveryOperations` stores immutable amounts and operation identities
before money moves. Outcomes distinguish `pending`, `unknown`,
`insufficient_balance`, `unsupported`, `failed`, `succeeded`, and `canceled`.
An unknown provider outcome retains its reservation and blocks another collection
or future commission release until receipt reconciliation finishes.

The client verifies the actual V2 Connect recipient's active
`configuration.recipient.capabilities.stripe_balance.stripe_transfers` capability
and the exact original transfer's destination, charge, currency and amount.
Reversals use that original transfer. Requests carry `bsRecoveryOperation`
metadata and a stable operation-specific idempotency key. Replay searches exact
provider receipts before issuing another request, including beyond the provider's
idempotency cache window. An unrelated aggregate reversal is not a receipt for
this operation. Confirmation records the receipt and accounting changes atomically.

A confirmed insufficient-balance response leaves durable debt instead of failing
indefinitely through webhook retries. Before a subsequent settlement creates an
affiliate transfer, the component atomically reserves the earning and applies
same-affiliate, same-currency debt offsets. Concurrent settlements cannot spend
one debt twice, and replay uses the original withheld/release amounts. A fully
withheld commission gets an earning record without a fabricated Stripe transfer.
Refunding that later commission creates its own obligation for the original full
commission, including units previously applied to older debt.

A later recovery attempt sizes itself from the remaining debt and reversible
provider funds. It cannot collect amounts already offset. Restorations use
platform-funded transfers, exact receipts and independent operation identities.
Funding, country/currency or capability failures remain visible and retryable;
failed restoration is not shown as paid.

Transfer reversal does not recall a completed bank payout. Available balance and
negative-balance behavior remain account/provider-specific. Global Payouts is
unsupported by this Connect recovery path and is never routed through a Connect
API by assumption. No card or bank debit is introduced.

## Trusted server APIs

The host must authenticate callers and derive affiliate accounts server-side.
Operator retry, legacy review and maintenance endpoints must not be exposed as
unrestricted browser mutations.

```ts
const snapshot = await stripe.affiliateRecovery.snapshot(ctx, {
  affiliateAccountId: authorizedAffiliateAccountId,
  currency: "usd",
  paginationOpts: { numItems: 20, cursor: null },
});
const attempts = await stripe.affiliateRecovery.history(ctx, {
  obligationId: authorizedObligationId,
  paginationOpts: { numItems: 20, cursor: null },
});
// Authenticated operator only; reconciles receipts before attempting recovery.
await stripe.affiliateRecovery.retry(ctx, {
  obligationId: authorizedObligationId,
});
```

Snapshot responses contain an exact per-account/currency `balance` and a
paginated `obligations` result (`page`, `continueCursor`, `isDone`). The balance
contains original commission, cumulative reversed, offset and restored amounts,
outstanding debt, reserved recovery/restoration, restoration owed, withheld
future earnings and net payable. Net payable means platform-held commission
reserved for release; it is not the connected account's bank balance. Read
provider balances and bank payouts separately with `getPayoutSnapshot`.

Rows retain original references, exposure snapshots, original/released commission,
confirmed recovery/offset/restoration, debt, latest state/error, and reconciliation
flags. A fully withheld row can omit `stripeTransferId`. History includes operation
amounts, outcomes and confirmed receipt IDs. Paginate history; do not sum a preview
page for account totals.

`createPayout` uses an atomic release gate for accounts with affiliate recovery
balances. Supply a stable `idempotencyKey` and an optional host-authorized
`minimumAmount` in that currency (default one minor unit). Debt, uncertain money
movement and concurrent payout reservations block release. The configured minimum
is application policy, not a discovered Stripe regional floor; provider floors
and balance requirements are still enforced by Stripe. A payout receipt marks
submission, not arrival in a bank. Stripe-managed automatic bank payouts cannot
be intercepted by this gate; future commissions are offset before their Connect
transfers leave the platform.

## Migration and operator reconciliation

Deploy the additive schema and matching component code together. Regenerate the
component and example bindings against the target deployment.

Call `components.betterStripe.settlement.mutations.migrateAffiliateObligations`
from an authenticated operator wrapper with:

```ts
{ paginationOpts: { numItems: 100, cursor: null } }
```

Pass each returned `continueCursor` until `isDone`. Replay is safe. `migrated` and
`skipped` describe that page, including already-existing obligations; they are not
cumulative counters. The backfill uses immutable settlement allocations and
initializes account totals. Legacy legs without allocations are skipped for
manual source review rather than assigned invented original economics.

Existing reversals/reservations without attributable provenance set
`needsReconciliation=true`. They retain their confirmed balance, but automatic
collection/restoration is paused for review. An operator can select exact
commission-reversal and prior reinstatement receipts:

```ts
await stripe.affiliateRecovery.reviewLegacy(ctx, {
  obligationId: authorizedObligationId,
  reversalIds: ["trr_original_commission_reversal"],
  restorationTransferIds: [], // Include any prior dispute-win reinstatements.
  note: "Reviewed original allocation and provider receipt history.",
});
```

This verifies the original transfer, each selected receipt, live successful
refunds and the monetary dispute, then commits the reviewed attribution and note.
Choose commission principal receipts, not unrelated adjustments. More than one
monetary dispute on a legacy source requires manual allocation. Inspect the new
snapshot before retrying recovery. The older generic reversal-claim reclaimer
delegates tracked affiliate operations to this ledger; its release mode cannot
delete an affiliate exposure audit record.

## Maintained reconciliation and bounds

Run both `reconcilePending` and `reconcilePayouts` for `pending` and `unknown`
states from a host cron. Pass `paginationOpts` and schedule the returned
`continueCursor` until `isDone`. The example's internal jobs run every five
minutes and process one row per invocation. Insufficient/unsupported recovery
remains collectible through future offsets; an operator can retry it after
account capability or funding changes.

Charge transfer/obligation reads and provider refund/receipt histories have
explicit bounds of 1,000 rows; exceeding a bound stops instead of applying partial
financial state. Offset transactions accept at most 1,000 open same-currency debt
rows. Snapshot, audit and migration queries are paginated with bounded pages.
Legacy review accepts at most 100 selected receipts and requires an operator note.

Subscribe to `refund.created`, `refund.updated`, `refund.failed`, and existing
`charge.dispute.created`, `.funds_withdrawn`, `.closed`, `.funds_reinstated` events.
Retain component financial records while events, provider operations or payouts
can still be retried.

## Reusable React views and example

`AffiliateRecovery` from `@fantastic.dev/better-stripe/react` accepts `snapshot`,
`currency`, optional locale/source-link/reconcile callbacks and a render function.
Its unstyled default view and headless view expose the same metrics and
package-formatted adjustment rows. `AffiliateRecoveryHistory` displays outcomes
and receipts. Use them alongside earnings, referred sales and payouts; seller
cost recovery remains a separate view.

The example adds authenticated affiliate snapshots and an operator recovery
page. Its existing persona picker is not authentication: a real identity's
`tokenIdentifier` must be provisioned into the user's `authTokenIdentifier`
field. Affiliate requests cannot select another account; operator permissions
come from that server-linked user's role. With no authenticated identity, live
recovery queries return no data and retries are denied.

Visit `/demo/affiliate-recovery` for ten **simulated** scenarios covering orders,
recurring invoices, partial refunds, open/lost/won disputes, overlap, insufficient
balance after external payout, future offsets and unknown provider outcomes.
`affiliateRecoveryScenarios()` is exported from the testing package. These are
presentation fixtures, not fabricated sandbox or bank-payout receipts.

## Stripe sandbox scenario driver

With the example deployed, its webhook endpoint registered, a test-mode key and
active distinct store/affiliate Connect recipients, run the internal fixture
from `example/`:

```sh
pnpm exec convex run affiliateRecoverySandbox:seed '{"runKey":"recovery-partial-1","storeAccountId":"acct_store","affiliateAccountId":"acct_affiliate","scenario":"refund_partial"}'
```

The driver creates a real test payment, settles the original allocation, creates
the selected refund and returns actual provider IDs/balances. A stable `runKey`
prevents duplicate payment/refund creation. `refund_full` covers a full refund;
`future_offset` creates the next commission against existing debt. For a recurring
invoice, supply its existing `paymentIntentId`, `invoiceId` and `subscriptionId`
from the subscription/test-clock fixtures so the driver verifies those links.

`dispute` uses Stripe's dispute-producing test token. Let the real webhook open
the monetary dispute, then use the documented sandbox dispute evidence/outcome
controls to exercise lost and won events; inspect actual receipts after each.
For overlap, refund the same original payment before or after the dispute and
verify the retained refund amount after a win. Do not manufacture terminal
webhooks as proof that provider funds were restored.

`paid_out` first returns `operator_step_required`. Complete an account-supported
external test payout, then rerun with its actual `completedPayoutId` and the same
payment/run key. The driver verifies the payout's paid status, currency, amount
and creation order before requesting the refund. Unsupported payout/account
controls must be reported as blocked, not simulated. The returned provider
balance and the post-webhook snapshot establish whether recovery succeeded or
left debt. Run `future_offset` afterward to verify the exact withheld amount.

The driver rejects live/missing Stripe keys. It makes real sandbox transactions
and does not delete their receipts. Record its JSON output and authenticated
snapshots as release evidence; an API response alone does not establish a bank
payout recall.

## Verification evidence

Automated integration tests execute the real component and client with an
idempotent provider fixture and exact-money assertions. They cover concurrent
offsets, fully withheld invoice refunds, timeout-after-success replay,
refund/dispute ordering, partial disputes, lost/won events, receipt matching,
payout reservations, migration and ownership enforcement. React tests verify
native/headless figures and unconfirmed restoration states.

[Verification report](evidence/affiliate-recovery-verification.md),
[UI recording](evidence/affiliate-recovery.webm) and
[screenshot](evidence/affiliate-recovery.png) show simulated fixtures and both
presentations. Reproduce with the frontend running, from `example/`:

```sh
node scripts/record-affiliate-recovery.mjs
```

Use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for a system Chromium installation.
The recording requires a Playwright-compatible FFmpeg executable.

For account preview prerequisites, see [Accounts v2 setup](accounts-v2-preview.md).

Live deployment and real Stripe sandbox verification could not run in this
execution environment: downloading the Convex backend was blocked and no Stripe
credentials were configured. These artifacts do not establish account-specific
negative-balance behavior or successful external-payout recall. Before release,
verify actual supported Connect accounts, currencies, insufficient-balance and
restoration behavior in a configured sandbox, and retain the provider receipts.
