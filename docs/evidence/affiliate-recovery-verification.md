# Affiliate recovery verification

## Automated checks

The repository validation command is `pnpm run check:all`. It runs build, lint,
design-system, formatting, typecheck, codegen-drift, size, debt, circular-import,
secret, Shadscan, test, coverage, repository-instruction and CI-parity gates.
Existing coverage floors and file-size budgets are unchanged.

The dedicated lifecycle suite executes the real client orchestration against the
real Convex component and an idempotent provider fixture. Its 15 cases verify:

- Exact original-transfer reversal and duplicate receipt replay.
- Paid-out/insufficient-balance debt with concurrent future offsets and currency isolation.
- Refunds of commissions that were fully withheld against older debt.
- Timeout after provider success, with release blocked until reconciliation.
- Refund/dispute overlap in either order, with independent refunds retained on wins.
- Partial lost disputes finalized without another debit.
- Offset restoration and cancellation of unpaid dispute debt on a win.
- Unsupported account capabilities surfaced for operator action.
- Payout minimums, unknown outcomes and concurrent payout reservations.
- Failed restoration remaining unpaid until a confirmed provider receipt.
- Restoration timeout reconciliation without a second payment.
- Terminal events arriving first and refunds after full restoration.
- Older reversal utilities blocked from bypassing already-applied offsets.
- Unattributed provider aggregates retaining reservations instead of permitting duplicate collection.

Additional tests cover rounding, multiple invoices, migration, bounded reads,
immutable original economics, ownership, default/headless UI figures and errors.
Example tests verify that an unauthenticated demo persona cannot obtain operator
rights or inspect another affiliate's recovery records.

## UI evidence

- [Recording](affiliate-recovery.webm): ten simulated scenarios and both reusable presentations.
- [Screenshot](affiliate-recovery.png): unknown recovery with debt and reserved funds shown separately.
- Reproduce with `node scripts/record-affiliate-recovery.mjs` from `example/`
  while the frontend runs at `http://127.0.0.1:5173`.

The visible banner identifies these as simulated accounting fixtures. Neither
artifact claims that a completed bank payout was recalled.

## Live verification still required before release

The execution environment could not download the Convex backend and had no
configured Stripe credentials. A real deployment push, authoritative deployment
codegen, and real Stripe sandbox execution were therefore unavailable.

The internal `affiliateRecoverySandbox:seed` driver and the
[sandbox runbook](../affiliate-clawbacks.md#stripe-sandbox-scenario-driver) are
included for that verification. Record actual provider receipt IDs, balances,
account capability restrictions and post-webhook snapshots before releasing.
Global Payouts is unsupported, and Connect transfer reversal is not a bank-payout
recall. No live-money evidence has been fabricated.
