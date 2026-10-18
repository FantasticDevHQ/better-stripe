# Metered usage verification

BetterStripe supports pay as you go, included monthly units with overages, and
paid prepaid credits. This matrix separates actual Stripe sandbox observations
from deterministic failure tests. It does not certify live-money eligibility or
production throughput.

## Reproduce the checks

From the repository root, with the pinned pnpm dependencies installed:

```sh
pnpm run build
pnpm exec vitest run src/client/usage src/component/usage src/react/workflows/Usage example/convex/meteredUsage scripts/usage-contracts-packed.test.mjs scripts/usage-composition-packed.test.mjs scripts/usage-models-packed.test.mjs scripts/verify-usage-evidence.test.mjs
node scripts/verify-usage-evidence.mjs
pnpm run check:all
```

The packed tests extract an actual `pnpm pack` archive into an external temporary
consumer. Import resolution is asserted against the extracted package. The
three-model test registers its actual compiled Convex component, invokes public
reservation and recording APIs, races competing work against the remaining units,
and renders the resulting balances through the packed React components. No
provider is called by that deterministic test. Its prepaid setup injects verified
fixture backing through internal component functions; native payment verification
is separately exercised through real SDK transports and the sandbox flows below.

## Three-model acceptance matrix

| Contract                                              | Pay as you go                                    | Included monthly units and overages                                  | Paid prepaid credits                                                              |
| ----------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Packed public API and actual component                | Immutable record and replay; configured hard cap | Reserve, consume, exact free/overage boundary and hard cap           | Unpaid purchase cannot reserve; verified backing, reserve, consume and exhaustion |
| Competing packed work                                 | Exactly one remaining-capacity request commits   | Exactly one remaining-capacity request commits                       | Exactly one last-units request commits                                            |
| Packed React view                                     | Actual allowance accounting and estimate         | Actual included quantity, overage and estimate                       | Actual available, consumed and exhausted balance                                  |
| Sandbox local/native effective units                  | 15 / 15                                          | 15 / 15, including 10 free units                                     | 10 / 10, funded by the original 10-unit purchase                                  |
| Original paid native usage invoice, USD minor units   | 1500                                             | 500, with native zero-priced included line plus overage line         | 0 due and paid; 1000 rated usage covered by original native credits               |
| Original cash source                                  | InvoicePayment → original PaymentIntent/Charge   | InvoicePayment → original PaymentIntent/Charge                       | Original paid purchase PaymentIntent/Charge, gross 1000                           |
| Actual processing fee, USD minor units                | 74                                               | 45                                                                   | 59 on the original purchase                                                       |
| Eligible seller / affiliate transfer, USD minor units | 1080 / 270                                       | 360 / 90                                                             | No seller redemption transfer; affiliate 180 on the original purchase             |
| Verified renewal observation                          | New native period retained                       | New native period retained; controlled-clock test proves local reset | Original paid-grant terms and consumption retained                                |

Each native row has both an issuer-only customer fixture and an eligible seller
fixture. The values above describe those specific USD sandbox cases, not universal
Stripe fees or rates. Settlement retries retained the original transfer IDs.

The original payment/invoice/settlement proof and UI recording are retained in
[the example evidence](https://github.com/FantasticDevHQ/better-stripe/tree/main/docs/evidence/usage-example). A subsequent native
aggregate refresh and complete retained ledger histories for all six fixtures are
in [the verification evidence](https://github.com/FantasticDevHQ/better-stripe/tree/main/docs/evidence/usage-verification). Financial
proof records when those invoices and purchases were verified; the refresh does
not claim a new cash observation or perform another payment or transfer.

## Failure and boundary matrix

These tests exercise the real component and real Stripe SDK transports with
controlled responses. Their fixtures are deterministic, not native charge or
network-failure recordings.

| Invariant                                                                                                                  | Executable coverage                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Concurrent duplicates, changed amount/version/time, exact source identity, tenant/mode/realm isolation                     | `src/component/usage/ledger.test.ts`, `src/client/usage/boundaries.test.ts`, `src/component/usage/historyIsolation.test.ts`                                                                                         |
| Host authentication boundary before reusable acceptance, guessed IDs and cross-tenant cursors                              | `src/client/usage/boundaries.test.ts`, `src/component/usage/historyIsolation.test.ts`, `src/component/usageCredits/accounting.test.ts`, `example/convex/meteredUsage/state.test.ts`                                 |
| Exact quantities beyond safe JS integers, unsupported API/definition versions, retained payload/history quotas             | `src/client/usage/contracts.test.ts`, `src/client/usage/deliveryProvider.test.ts`, `src/component/usage/ledger.test.ts`, `src/component/usage/allowanceBounds.test.ts`, `src/component/usageCredits/quotas.test.ts` |
| Partial batches, rate limits, restarts, lost responses and provider success followed by receipt failure                    | `src/component/usageDelivery/workflow.test.ts`, `src/client/usage/catalog.test.ts`, `src/client/usage/correctionRecovery.test.ts`, `src/client/usage/creditProvider.test.ts`                                        |
| Unknown responses beyond the retry window cannot send blindly; native clock/time-window guards                             | `src/component/usageDelivery/workflow.test.ts`, `src/client/usage/deliveryProvider.test.ts`                                                                                                                         |
| Complete summaries, lag, stale observations, scope mismatch and incomplete histories cannot become a successful zero       | `src/client/usage/reconciliation.test.ts`, `src/client/usage/providerObservation.test.ts`, `src/component/usageObservations/queries.test.ts`, `src/react/workflows/Usage.test.tsx`                                  |
| Included-unit reservation, concurrency, hard/soft caps, price changes, half-open periods and new-period reset              | `src/component/usage/allowance.test.ts`, `src/client/usage/allowanceTerms.test.ts`                                                                                                                                  |
| Prepaid payment gating, concurrent last-unit spending, duplicate backing, delayed grants and exhausted balance             | `src/component/usageCredits/accounting.test.ts`, `src/client/usage/creditProvider.test.ts`, `scripts/usage-models-packed.test.mjs`                                                                                  |
| Original grant application, native invoice credits, reservation freshness and bounded complete backing proof               | `src/client/usage/creditInvoice.test.ts`, `src/client/usage/creditObservation.test.ts`, `src/client/usage/creditProofBounds.test.ts`, `src/component/usageCredits/freshness.test.ts`                                |
| Corrections before/after billing cutoff, native pending cancellation, late credit notes and no invented refund             | `src/client/usage/correctionClient.test.ts`, `src/client/usage/correctionRecovery.test.ts`, `src/client/usage/correctionInvoice.test.ts`, `src/component/usageCorrections/corrections.test.ts`                      |
| Paid original invoice, actual processing fee, one-time/forever commission and no duplicate transfers after receipt failure | `src/client/usage/invoiceSale.test.ts`, `src/client/usage/settlement.test.ts`                                                                                                                                       |
| Prepaid refunds, disputes, won reinstatement, consumed backing, affiliate recovery and no second sale on redemption        | `src/client/usage/creditSettlementRecovery.test.ts`, `src/component/usageCredits/accounting.test.ts`, `src/client/usage/creditRevenue.test.ts`                                                                      |
| Saved success cannot bypass later cash uncertainty or unresolved settlement during cleanup                                 | `example/convex/meteredUsage/revenue.test.ts`, `example/convex/meteredUsage/cleanupRefresh.test.ts`                                                                                                                 |

## Comparison and hold rules

Compare explicit original scope, meter, price/version, subscription item and
half-open billing period. Native aggregation can lag. A temporary match is an
observation, not invoice finality. Missing, stale, truncated or unavailable evidence
stays unavailable or held. The retained native proof uses zero tolerance in scaled
units after aggregation has settled. Exact decimal rates and scaled integer units
avoid rounding discrepancies; estimates remain labelled estimates. Only a complete
finalized original invoice determines the rated amount. A paid zero-dollar prepaid
invoice cannot create cash revenue.

The evidence auditor checks all six native aggregates against complete local
histories, original invoice lines, exact quantities and original cash/transfer
identities. It also checks conservation of original gross across actual processing
fees, retained platform proceeds and executed transfers. Corruption tests reject
unknown/stale/partial data, changed quantities/prices, foreign cash and duplicate
transfer identities. It audits retained proof; it cannot replace a fresh provider
reconciliation before a financial operation.

## Tested limits

The sandbox issuer and eligible seller/affiliate recipients support the recorded
Accounts v2 and Connect flows. A seller without transfer capability retained paid
cash evidence but remained held for settlement; cleanup refused to erase it.
Issuer-only customer billing was also exercised on the same platform issuer.
This does not establish a separate non-Connect customer-only preview account's
eligibility. Billing under connected-account headers is not supported by the
current usage adapters. Those cases require their own verified API/account
configuration. Eligibility remains tied to the original account configuration,
currency, API access and native capabilities.

Native test clocks advanced billing and exposed the next subscription period.
That future period is outside the real server's current allowance acceptance
window. Its allowance is explicitly `not_active_yet`, not zero or accepting. A
controlled-clock component test proves monthly counter reset while retaining the
old period. The sandbox does not establish a future-period production send before
its real acceptance window, or a wall-clock month of production operation.

No native live dispute was created. Refund/dispute recovery, transport ambiguity,
worker/DB failures, retained quota limits and API-version refusals use deterministic
SDK/component tests. No load or sustained throughput certification is claimed.
These checks authorize neither live billing nor automatic production migration,
publication or replay of unknown historical provider writes.
