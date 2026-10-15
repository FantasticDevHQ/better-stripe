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
Five combined-payout integration cases also verify debt blocking, currency
isolation, competing direct/combined reservations, debt arriving before the
provider attempt, and uncertain payouts retaining locks until verified receipts.

Four direct-payout integration cases additionally verify new debt arriving during
receipt lookup, expiration of the provider idempotency window, confirmed-receipt
replay, and reconciliation of an expired operation despite later debt. No new
Convex API or schema shape was introduced for these safeguards.

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

The selected cloud environment can reach the intended deployment, but has no
`CONVEX_DEPLOY_KEY` secret binding. On 2026-10-15, the deployment `/version`
endpoint returned HTTP 200; `convex run actions:checkEnvVars '{}'` failed with
`401 MissingAccessToken` while resolving the deployment through `api.convex.dev`.
`convex dev --once --typecheck enable` also stopped at authentication before any
push. `pnpm run codegen` failed with the same `401 MissingAccessToken` before
authoritative generation. Neither command verified deployed code or Stripe credential presence.
Existing Stripe/webhook credentials on the deployment have not been read or
replaced. No setup/reset scripts were run.

Authoritative deployment code generation, schema validation against existing
data, test-mode confirmation, real provider receipts, account capabilities and
the authenticated UI → backend → provider → accounting flow remain unverified.
The demo persona picker cannot supply authenticated operator or affiliate access.
The example also has no `convex/auth.config.ts`; a real host JWT issuer and
server-linked identity must be configured before authenticated UI acceptance can
be exercised. Provisioning a persona alone does not configure token validation.

The internal `affiliateRecoverySandbox:seed` driver and the
[sandbox runbook](../affiliate-clawbacks.md#stripe-sandbox-scenario-driver) are
included for that verification. Record actual provider receipt IDs, balances,
account capability restrictions and post-webhook snapshots before releasing.
Global Payouts is unsupported, and Connect transfer reversal is not a bank-payout
recall. No live-money evidence has been fabricated.

## Acceptance traceability

The following maps every project acceptance group to source and available
verification. Tests use provider fixtures unless explicitly described as live.
A covered automated case does not satisfy a requirement for Stripe sandbox
receipts. The project and PR remain open pending the live checks above.

### original obligations and overlap

| Acceptance                                                                                                           | Implementation and automated evidence                                                                                                                                                                                      | Remaining verification                                                  |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Original payment/invoice, recipient, currency, commission and receipts; independent invoices and original terms      | `src/component/settlement/clawbacks.ts`, `affiliateRecovery/schema.ts`; `affiliate-clawbacks.test.ts` checks invoice isolation, fixed amounts and immutable identity; example subscription commission tests preserve terms | Real recurring invoice refund receipts and authoritative schema/codegen |
| Cumulative successful partial/full refunds and deterministic rounding; exclude pending/failed                        | `src/client/connect/refundPrincipal.ts` and refund reversal orchestration; clawback and lifecycle suites check cumulative refunds and integer precision                                                                    | Real partial/full refunds and post-webhook snapshots                    |
| Shared refund/dispute exposure, original cap, provisional/finalized state                                            | `src/component/settlement/clawbacks.ts`; lifecycle suite checks both overlap orders and retained refunds                                                                                                                   | Live overlap through terminal dispute events                            |
| Duplicate/reordered/concurrent events, indexed bounds and explicit migration                                         | `affiliateRecovery/accounting.ts`, `settlement/mutations.ts`; clawback tests check concurrent reservations, replay-safe migration, exact receipt replay and the 1,000-row bound                                            | Backfill against existing development data and live replay              |
| Exact-money tests for partial refunds, overlap, invoices, fixed/currency rounding and crashes; seller costs separate | `affiliate-clawbacks.test.ts`, `affiliate-recovery-lifecycle.test.ts`, separate `costRecovery` modules                                                                                                                     | Complete live accounting snapshots including seller costs               |

Component paths in this table are relative to `src/component/`; test filenames
refer to that directory unless qualified otherwise.

### paid-out recovery and future offsets

| Acceptance                                                                               | Implementation and automated evidence                                                                                                                        | Remaining verification                                                       |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Exact original transfer, stable operations, receipts and all outcome states              | `src/client/affiliateRecovery/provider.ts`, `engine.ts`; lifecycle tests cover receipt replay and timeout after success                                      | Real reversal receipt IDs and unknown-outcome reconciliation                 |
| Actual capabilities and external payout restrictions; Global Payouts                     | Provider capability checks; unsupported-path lifecycle test; runbook explicitly excludes Global Payouts and bank-payout recall                               | Actual recipient capability responses and completed test payout restrictions |
| Same-account/currency durable debt and atomic future offsets; no seller principal charge | `src/component/affiliateEarnings/mutations.ts`, recovery accounting; lifecycle tests check concurrent offsets, currency isolation and fully withheld refunds | Real insufficient-balance response followed by new commission offset         |
| No duplicate offset/reversal; payout minimums, release reservations and concurrency      | Lifecycle and `payout-recovery-integration.test.ts` cover direct/combined locking, new debt before attempt and unknown outcomes                              | Live direct and combined payout attempts with debt and reservations          |
| No unauthorized card/bank debit; unsupported operations visible                          | Recovery engine only reverses original transfers or restores through transfers; unsupported state and operator UI                                            | Account-specific provider rejection evidence                                 |
| Sandbox adequate balance, paid-out debt, offsets, timeout and retries                    | Internal sandbox driver; provider-fixture lifecycle coverage                                                                                                 | All real provider acceptance evidence remains pending                        |

### dispute lifecycle

| Acceptance                                                                        | Implementation and automated evidence                                                                     | Remaining verification                                                          |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Monetary opening exposure; exclude inquiries/warnings/non-debited events          | `src/client/affiliateRecovery/disputes.ts` and dispute reversal orchestration; webhook and clawback tests | Actual monetary and non-monetary provider events                                |
| Lost finalization without debit; win restores collections and cancels unpaid debt | Lifecycle tests check partial loss, offset then win and unpaid debt cancellation                          | Real lost/won or funds-reinstated events where supported                        |
| Independent refunds and event-order convergence                                   | Lifecycle overlap cases, terminal-event-first case and refund after restoration                           | Live refund/dispute overlap snapshots                                           |
| Receipt-backed idempotent restoration and visible funding/currency failures       | Recovery engine/provider; failed restoration and restoration-timeout tests                                | Real restoration receipts and account funding/cross-border restrictions         |
| Partial disputes/refunds, debt, offsets, repeated terminal events and crashes     | `affiliate-recovery-lifecycle.test.ts`, `affiliate-clawbacks.test.ts`                                     | Provider-supported scenario results, with unsupported cases recorded as blocked |

### UI, sandbox and documentation

| Acceptance                                                                                                                   | Implementation and automated evidence                                                                        | Remaining verification                                                            |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Earnings, sales and payouts show original/recovered/debt/reserved/withheld/net amounts by currency and original source links | Public `AffiliateRecovery` and example recovery views; `AffiliateRecovery.test.tsx` verifies financial state | Authenticated live screens backed by real receipts                                |
| Operator history/retry and affiliate ownership; seller costs distinct                                                        | `example/convex/affiliateRecovery.ts` and its auth tests; separate seller cost views                         | Real identity provisioned server-side and live cross-account denial               |
| Reusable native/headless package views with equivalent figures                                                               | `src/react/components/AffiliateRecovery.tsx` and tests                                                       | Live consumption in example layouts                                               |
| One-time/invoice/partial/dispute/overlap/paid-out/future scenarios, without fabricated payout recovery                       | Internal sandbox driver and explicitly simulated presentation fixtures                                       | Run documented scenarios with actual account/invoice IDs and retain outputs       |
| README/API/example docs, webhooks, provider/preview limits, debt and manual reconciliation                                   | README, example README, `docs/affiliate-clawbacks.md`, settlement and Accounts v2 guides                     | Confirm actual deployment/account restrictions after access is restored           |
| Exact-money assertions, repository gates, reviewer UI recording and sandbox output                                           | Lifecycle/component/UI suites, linked recording/screenshot, check results above                              | Current integration gate results below and actual sandbox receipts before release |

## Integration with current main

Main now includes historical payout adoption and funded policy activation
(PR #192, released as 0.23.0). The integration preserves the historical-adoption
mutation import/export alongside the affiliate recovery reservation helpers in
`src/component/payoutRelease/mutations.ts`. Historical adoption records verified
past payouts; new direct and combined payout attempts still use their recovery
guards. Reviewing the integrated paths also found that direct payout replays
needed a debt recheck after receipt lookup and an expiration guard. Those checks
now prevent another provider attempt, retaining uncertain reservations. Maintenance
reconciles an already-existing receipt even when later debt blocks a fresh attempt.
The merge does not establish authoritative deployment code generation.
