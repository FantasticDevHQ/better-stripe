# Affiliate recovery verification

Verified on 2026-10-15 from the local Mac, on branch
`feat/affiliate-commission-clawbacks`, backend revision `979f68e` and UI revision `b3baebc`, against the
existing development deployment `fabulous-egret-37`. Stripe mode was `test`.
No setup/reset scripts, authentication provider, credentials or webhook
replacement were used.

## Live results

Both US V2 recipients had active `stripe_transfers` and `payouts` capabilities
in a fresh provider sync. The example's Stripe secret and both webhook secrets
were present, checked as booleans without exposing their values. Authoritative
component and example code generation, deployment, and enabled Convex
typechecking succeeded against the existing deployment.

Each case below allocated an original 1,001-unit USD affiliate commission on a
10,000-unit payment. The actual webhook-driven recovery and receipt history were
read back from the deployed component. All five refunded obligations have zero
remaining debt and no duplicate receipt after reconciliation.

| Case                                        | Actual refund                 | Actual reversal receipt        | Commission recovered |
| ------------------------------------------- | ----------------------------- | ------------------------------ | -------------------: |
| Partial order, 5,000-unit refund            | `re_3UQoE06JR7kThJog1hjooLOn` | `trr_1UQoET6JR7kThJogZPgiQE2n` |                  501 |
| Full order                                  | `re_3UQoFS6JR7kThJog0z1JyLQ3` | `trr_1UQoGJ6JR7kThJogsAd4e2hI` |                1,001 |
| First recurring invoice, partial            | `re_3UQoNM6JR7kThJog1uIoKIXY` | `trr_1UQoOT6JR7kThJogqz23W4Ha` |                  501 |
| Second recurring invoice, full              | `re_3UQoOd6JR7kThJog1WRrd305` | `trr_1UQoQ66JR7kThJog6q5YJua5` |                1,001 |
| Full refund after completed external payout | `re_3UQoSq6JR7kThJog0SyOG89R` | `trr_1UQoVt6JR7kThJogPvRydkms` |                1,001 |

The recurring cases belong to subscription `sub_1UQoNM6JR7kThJoggs0OjC4F`.
Their distinct invoices are `in_1UQoNM6JR7kThJogpqDwq4rs` and
`in_1UQoOY6JR7kThJognq1wCRQ5`, produced by advancing the isolated test clock
`clock_1UQoNK6JR7kThJogvaFaEnbQ`. Existing persona subscriptions were unchanged.

The external payout `po_1UQoUC8nH9jL5c4a2Dlkho9Q` reached actual `paid` status
for 1,001 USD minor units before the refund. Stripe then allowed the original
transfer reversal and reported **negative 501 available USD minor units**, with
145,970 pending. This account therefore did not produce insufficient-balance
commission debt. The reversal did not recall the completed bank payout.

An earlier attempt to settle a bypass-pending fixture failed with Stripe's
insufficient available platform-funds error. Explicit sandbox funding payment
`pi_3UQoQg6JR7kThJog0yqoRi05` was created for 100,000 USD minor units. Platform
available balance updated asynchronously from 6,996 to 104,066. A fresh fixture
then settled. The failed settlement's reserved earning remains visible in
account totals; it is not a bank balance or a confirmed transfer.

Migration completed in four bounded pages. Eleven rows were migrated or replayed;
116 affiliate legs without immutable allocation evidence were skipped for
manual review. Those skipped rows were not assigned invented economics.
See [migration output](affiliate-live/migration.json).

## UI evidence

The actual local frontend read the deployed financial state with the existing
demo persona selector. The affiliate headless and reusable component views
both displayed original 1,001, reversed 501, debt zero for the partial order.
The admin's Reconcile button returned the same confirmed 501-unit receipt with
no second collection. Persona checks bind resources to a claimed demo user;
they do not prove authenticated production ownership.

A separate purchase and refund were completed entirely through the existing
Payment Element checkout and seller refund UI. Its payment was
`pi_3UQorZ6JR7kThJog1n2pPoNk`; the UI created refund
`re_3UQorZ6JR7kThJog1oea19Rd` for 5,000 minor units. The actual original
commission was 9,100 minor units and recovery confirmed exactly 4,550 through
`trr_1UQouv6JR7kThJogkUZeyvWo`, with zero debt. The affiliate view showed
$91.00 original, $45.50 recovered and $0.00 debt.

The isolated product's initial fixed-rate test setup used `1001` in the example's
**major-unit** setting, so the commission correctly capped at the 9,100-unit
remainder. That setup mistake was corrected to `10.01` major units before the
refund. Recovery retained the actual original allocation instead of applying
the new 1,001-unit rate. Existing product/store defaults were unchanged. An
earlier checkout on a product with payouts disabled produced no affiliate
commission; a raw CLI fixture was also correctly rejected by the seller UI's
ownership guard. Neither was counted as a successful UI clawback.

[UI fixture and rate snapshots](affiliate-live/ui-fixture.json),
[before-refund accounting](affiliate-live/ui-purchase-before-refund.json) and
[UI refund and exact-money assertions](affiliate-live/ui-refund-result.json)
retain this additional live case. The internal raw-payment driver is intended
for trusted CLI settlement; seller UI verification uses the storefront's routed
payment-creation API.

- [Live screenshot walkthrough](affiliate-live/sampled-ui-walkthrough.mp4),
  a video assembled from sampled screenshots, not a continuous recording.
- [Headless view](affiliate-live/01-affiliate.jpg) and
  [reusable component view](affiliate-live/02-components.jpg).
- [Admin before reconciliation](affiliate-live/03-admin-before.jpg) and
  [confirmed receipt afterward](affiliate-live/04-admin-reconciled.jpg).
- [UI purchase succeeded](affiliate-live/05-checkout-paid.jpg),
  [seller refund before](affiliate-live/06-ui-refund-before.jpg),
  [actual refund result](affiliate-live/07-ui-refund-result.jpg), and
  [affiliate accounting afterward](affiliate-live/08-ui-affiliate-accounting.jpg).
- [Timed assertions](affiliate-live/annotations.json).
- [Four-refund snapshots and exact receipt assertions](affiliate-live/verified-refunds.json).
- [Snapshot before payout](affiliate-live/before-payout.json) and
  [after the paid-out refund](affiliate-live/after-paid-out-refund.json).
- [Final provider/accounting evidence](affiliate-live/final-state.json).

The subsequent no-debt earning released its full 1,001-unit commission. This
checks that recovery does not falsely withhold a debt-free earning; it does not
establish an offset against real debt.

The earlier [recording](affiliate-recovery.webm) and
[screenshot](affiliate-recovery.png) still show ten explicitly simulated
presentation scenarios. They are separate from the live evidence above.

## Automated verification

The focused eight-file run passed 48 tests after the fixes. It includes original
obligations, recovery lifecycle, direct and combined payout guards, demo persona
bindings, internal sandbox helpers, and a regression that enforces the deployed
component restriction against native `paginate()`. The deployed failure was
reproduced before switching recovery, history, reconciliation, migration and
pending payout reads to the component-compatible paginator.

The real sandbox driver also exposed mutually exclusive Stripe payment-method
parameters. Its regression failed before removing that conflict. The live UI
previously failed on native component pagination; the screenshots above show
the corrected deployed reads.

The lifecycle tests use the real component/client with an idempotent provider
fixture. They cover concurrent same-currency offsets, fully withheld invoice
refunds, unknown outcomes after provider success, exact receipt replay,
refund/dispute overlap, terminal-event ordering, losses, restoration, migration,
bounds and payout reservations. These fixture results do not become live Stripe
claims.

The final `VITEST_MAX_WORKERS=1 corepack pnpm run check:all` passed all 15
gates, including 267 test files and 2,420 tests in both the ordinary and
instrumented runs. Lint, typechecks and size checks also passed individually. React Doctor reported
82/100 with warnings, including serial financial operations and component
complexity, and no error diagnostics. The final repository-wide validation
result is retained in [check output](affiliate-live/checks.txt). Coverage floors,
file budgets, Shadscan policy and test timeouts are unchanged.

## Remaining acceptance limitations

- **Insufficient-balance debt and subsequent debt offsets:** not reproduced live.
  This account accepted reversal into a negative available balance. A separate
  supported account/scenario that rejects the exact reversal is required.
  A no-debt future earning cannot establish debt offset correctness.
- **Post-transfer dispute loss/win/restoration and overlap:** not verified live.
  Payment `pi_3UQoFV6JR7kThJog162snGZa` produced actual dispute
  `du_1UQoFW6JR7kThJogZy85f0A3` before settlement. The driver returned
  `not_payable / charge_refunded_or_disputed` and created no affiliate transfer.
  That does not verify commission clawback or restoration. A provider-supported
  post-settlement dispute workflow is still required. Stripe documents its
  [test dispute and terminal-evidence controls](https://docs.stripe.com/testing#disputes).
- **Unknown recovery outcomes and direct/combined debt/reservation guards:**
  verified by automated provider-fixture tests, not an induced live provider
  timeout or live account debt. No artificial debt or fabricated receipts were
  inserted into the deployment as evidence.
- **Legacy skipped legs:** require manual source/receipt review. Migration output
  is a page count, not proof that every historical commission was adopted.
- **Production ownership:** the example intentionally uses demo personas.
  Production hosts must supply authenticated, server-derived authorization.
- **Global Payouts:** unsupported by this Connect path. No card/bank debit or
  completed-payout recall was introduced.

The PR and project remain open. The live evidence above supports the listed
refund and payout cases, not completion of every acceptance scenario.
