# BetterStripe final package/example acceptance

PR #229, final source 27d9de8662bee7880afafb98a05bb320f724e48d. All 15 repository gates passed in 80.8 seconds, line coverage 78.1%. Embedded payout regression first failed for both seller and affiliate, then all four tests passed. The panel now disables bank payout creation and schedule changes so it cannot bypass application minimums.

## Fresh native sandbox setup

[Recorded passing reset/reseed](reset-reseed.webm), [completion screenshot](reseed-complete.png), [browser log](reset-reseed-pass.log). All 56 fixture steps completed automatically, with eight personas and no duplicate personas after rerunning seed. The existing total 720-second and fixture 600-second test budgets are unchanged. Fixture timing starts after account provisioning. This recording predates only the final embedded payout permission fix; fresh seed/runtime financial code is identical. The final source's regression suite and gates cover that permission fix.

The fresh run required replenishing an exhausted platform test balance, using the existing test-mode funding helper. Earlier failed attempts and their fixes are described in PR #229 and the separate affiliate-seed-18043c8 evidence. This is an actual isolated BetterStripe anonymous Convex deployment, never the mixed generic anonymous-agent database. Reset removes example database records; it does not delete historical Stripe objects.

## Real refund/dispute costs and automatic bank payout

[Held balance screenshot](cost-aware-held.png), [before receipt](cost-aware-before.json), [full public-SDK native report](native-cost-payout-report.json), [paid receipt](cost-aware-paid.json), [paid UI](cost-aware-paid.png), [receipt and opt-out video](cost-aware-receipt-and-opt-out.webm), [restored receipt](cost-aware-restored.json), [restored UI](cost-aware-restored.png), [assertions](cost-aware-assertions.json).

The real sandbox seller balance was USD 2,173.74, with USD 44.18 of actual refund/dispute costs. A high custom minimum carried forward USD 2,129.56 and withheld USD 44.18. The actual reusable UI saved a USD 1 minimum with consent. The installed five-minute production worker created payout po_1UR6nW7stADwEsXADqIlV5IA for exactly 212956 minor units, verified paid. Its bsPayoutClaim metadata matches the durable worker's completedOperationKey. No direct payout call, worker dispatch, fabricated fee, or clock change was used for this release.

Exactly two payouts exist: this new payout and the adopted USD 10 historical fixture payout. Provider balance remains 4418; accounting released is 213956, carried forward and reserved are zero, withheld costs remain 4418. Costs were not forgiven or marked collected. The UI restored Stripe-managed daily payouts, verified through the provider's actual balance settings. Page errors were empty.

The initial UI script successfully saved the minimum but then timed out because it selected `Refresh policy` instead of the button's accessible name `Refresh payout policy`. This is disclosed in cost-aware-initial-selector-timeout.log; it is not represented as a passing browser test. The follow-up recording verifies the actual paid receipt and opt-out. The financial payout succeeded independently through the installed cron. private-native-controller.ts.txt is a private QA adapter, not shipped code; initialization/adoption/settings use public package methods, and provider reads verify receipts.

Actual Stripe events were fetched, scoped to owned QA recipients/charges, and replayed using a local signed transport. All 185 events returned HTTP 200. This proves application processing of real provider payloads, not original Stripe webhook delivery. No live money or live bank delivery is claimed. No API keys or signing secrets are included.

## Earlier linked acceptance

The package's existing public evidence remains relevant: payout-adoption-26f3ca8 for 205 real transfer sources and 101 historical payouts plus production worker execution; payout-attempt-f2536dd for genuine Stripe insufficient-balance rejection; payout-expiry-recovery-aabb797 for expiry/recovery/reset refusal and schedule restoration; bts-171-final-audit for the combined-role exact-threshold and concurrency audit. Those are separately recorded tests, not rerun or simulated by this final cost test. Dojo adoption is independently tracked under Kelly's explicitly approved completion boundary.
