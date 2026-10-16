# Bounded reconciliation and activation-race evidence

Final PR head: `a4e3c003bba4639cca975415f685dec811150d07`. All 15 clean-checkout gates pass, 77.9% line coverage. Exact-head CI, code generation and Shadscan pass. No existing timeouts, gate floors or size budgets were changed. Final exact-head proof is in `payout-batch-boundary-all-gates.log` and `payout-batch-boundary-ci-pass.log`; other logs retain scoped earlier failures and diagnostics.

## Real Stripe sandbox

A fresh owned sandbox recipient received 205 actual funding transfers totaling 10,250 cents, then 101 actual historical bank payouts of 100 cents each. Before public adoption, there were zero local claims/allocations and exactly 150 available cents. Public `adoptPayouts` imported and verified every historical payout/source in 87.7 seconds. Funded preparation completed in 118.6 seconds and preserved the actual oldest unpaid source age and original weekly schedule until activation. Financial claims/allocations were not imported through private fixture mutations. A bounded read-only QA query inspected counts; actor-allowlisted internal actions invoked the public SDK.

This financial scenario ran at `4477f10`. The production cron completed activation while an identical client caller was between proof verification and beginAttempt. The caller received a real server error, although the durable operation was complete. Saved state and the transcribed captured error are included in `sandbox-verification.json`. This exposed the later activation boundary race and was fixed before merge.

The production recurring worker paid exactly the remaining 150 cents once. All 102 provider payouts are paid, totaling 10,250 cents. The ledger has 205 allocations, zero reserved principal, zero available/pending funds and no disposable proof caches. Native amounts and IDs are in the JSON report; transfers are fixture funding rather than customer-checkout or commission-rate coverage.

## Final-code controlled race

On `a4e3c00`, the same recipient's existing 205 sources and 102 paid payouts were verified through public funded preparation again. After the real scheduled payout completed and its worker was idle at zero balance, only the owned QA automatic cron was temporarily paused to isolate two callers. One public apply caller waited immediately before beginAttempt until the other completed. The delayed boundary was reached, both callers returned ready, and the same durable operation was complete/attempted. Bank payout count and principal stayed unchanged. No fixture mutation wrote financial claims, allocations or policy outcomes.

The production cron was restored afterward and completed a new below_threshold check on final code, without another bank payout. Cleanup used public policy operations to restore the original weekly Monday schedule, verified zero funds and no in-flight bank payouts, and closed the owned recipient. The restoration operation is complete. No UI changed in this PR; backend logs and native API output are the current evidence. The earlier UI video in PR #224 remains separately scoped.

## Regression coverage

RED/PASS logs cover 101 separate outcome transactions reduced to bounded batches, whole-batch rollback, five-request provider concurrency, optional primary cache IDs, indexed fallback for older caches, foreign-ID rejection, unchanged-cache writes and final live transfer checks. Allocation work is bounded per batch without truncating history or imposing a new cutoff on a large individual outcome. Deterministic activation tests reproduce both the consumed-proof and beginAttempt races; a lost-response case verifies one durable attempt, and genuine unattempted failures still reject. Exact-money, stale, returned, unknown and concurrent-funding cases remain covered by the unchanged full gates.
