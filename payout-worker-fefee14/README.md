# Payout worker with current main and clawbacks

Exact head: `fefee14a3454ed55ef056bc3d26d0915fa5db2e5`. Includes origin/main `49f38ac`, the merged affiliate clawback implementation, and the 0.23.2 payout synchronization contracts.

All 15 repository gates passed, including the full test suite, codegen drift, type checks, Shadscan and 76.6% line coverage. The 28 focused integration tests additionally verify that affiliate recovery debt holds fresh payout attempts, accepted unknown payouts still reconcile after new debt and opt-out, and pending/unknown direct affiliate payouts or recovery operations block reset. Both example cron schedules are retained.

The compiled package was deployed to an explicitly named separate local Convex backend and tested against the real Stripe sandbox at this exact head. $5.99 creator funding plus $4.00 affiliate funding stayed owed below the $10 threshold. An early retry was held. Another $0.01 affiliate transfer qualified the combined balance; after the persisted next-attempt time the worker paid $10 exactly once. A duplicate invocation created no additional payout. See the receipt and source allocations in `stripe-sandbox.json`.

The original weekly schedule was restored, the balance was zero and the QA recipient was closed. This verifies sandbox provider execution, not live-money bank delivery. Example cron action invocation and recovery holds use the automated provider-boundary harness. Existing real clawback provider evidence belongs to merged PR #191; the live run here exercises the new payout worker with no outstanding recovery debt.

The local manifest remains read-only. Provider-history continuation, scalable monetary binding beyond current limits, React controls and linked consumer acceptance remain open in BTS-171/BTS-172. This evidence does not claim those requirements complete.
