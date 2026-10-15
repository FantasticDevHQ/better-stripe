# Recipient payout worker: latest main integrated

Exact head: `30ea933a6c85923a8fee4f8c0cbf7ff23519269d`, including origin/main `eaa9210` and BetterStripe 0.23.2 payout synchronization.

All 15 repository gates passed, including the full test suite, coverage at 76.7% lines, type checks, codegen drift, Shadscan, size and secrets checks. See `repository-gates.txt`.

The compiled package was deployed to an explicitly named, separate local Convex backend and tested against the real Stripe sandbox again at this head. $5.99 creator funding plus $4.00 affiliate funding stayed owed below the $10 threshold. An early retry was held. After another $0.01 affiliate transfer and the persisted next-attempt time, the worker paid $10 exactly once. A duplicate invocation created no further payout. Exact receipts and source allocations are in `stripe-sandbox.json`.

The original weekly payout schedule was restored, the recipient balance was zero, and the QA recipient was closed. No live-money bank delivery is claimed. The shared cloud deployment was not changed.

Example cron action invocation is covered by the automated provider-boundary tests; this sandbox run verifies compiled package execution rather than claiming a deployed cloud cron. Earlier focused worker tests are retained in `../payout-worker-e2762ac/`. The current full suite includes those tests and the payout synchronization tests added on main.

Provider-history continuation, scalable monetary binding beyond current limits, React controls and linked consumer acceptance remain open in BTS-171/BTS-172. The read-only manifest is not payout authorization.
