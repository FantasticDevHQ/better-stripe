# Payout reconciliation performance evidence

Exact implementation and clean-checkout gate head: `cfe8a654c0fb30756c9dc62bf3175a47cd12e220`.

Release PR #225 exposed a 15-second coverage timeout in the existing 205-source/101-payout activation regression. Its failed CI log is preserved here. No timeouts, gate floors or size budgets were raised. The first batch-only implementation preserved behavior but did not reduce covered CPU work enough. Profiling identified repeated indexed reads and unchanged source-cache writes. Optional cache primary IDs, atomic allocation-row reuse and no-op write avoidance reduced the locally observed covered activation to about 4.4–4.7 seconds, compared with 6.6 seconds for the intermediate batch-only change. These are local measurements, not a claim of an exact CI duration.

All 15 repository gates pass at this head, 77.8% line coverage. Focused tests prove bounded reconciliation transactions, whole-batch rollback, provider concurrency, legacy cache fallback, foreign primary-ID rejection and final live ledger checks. Original exact-money and concurrent-activation cases remain covered by the full gates. RED and PASS logs are explicitly named; targeted coverage profiles are diagnostic only.

Fresh native sandbox verification with 205 actual funding transfers and 101 actual previous payouts is still running. Public adoption, activation, scheduled payout, replay and cleanup evidence will be added before merge. No claim of native completion is made yet. PR #224's prior implementation evidence remains separately scoped.
