# Recipient payout worker evidence

Source: `e2762ac93ba0c19b69f31d42650ab1064f3345eb`.

- All 15 repository gates passed; coverage is 76.4% lines.
- 33 focused component, package and example tests passed. Tests cover actual scheduled action invocation, combined creator/affiliate funds, a later qualifying transfer, concurrent workers, interrupted leases, unknown outcomes, a successful provider response lost before recording, opt-out reconciliation, uncollected invoice-reserved recovery costs, and refusal of an unsafe reset before deleting owner bindings.
- The compiled package ran against a separate local Convex backend and the real Stripe sandbox API. $5.99 creator funding plus $4.00 affiliate funding stayed owed below the $10 threshold. An early retry was held. After another $0.01 affiliate transfer and the persisted next-attempt time, the worker paid $10 exactly once. Duplicate invocation created no further payout.
- The real sandbox receipt and source allocations are in `stripe-sandbox.json`. The original weekly schedule was restored, remaining balance was zero, and the QA recipient was closed. Sandbox bank payouts simulate bank delivery; no live-money bank transaction is claimed.

The example cron invokes real scheduled Convex actions in the automated harness, using a deterministic Stripe provider boundary. The separate sandbox run verifies the compiled package's worker and actual Stripe requests, not a deployed cloud cron.

Shared cloud deployment was intentionally preserved because it contains work from the separate clawback branch. The local manifest remains read-only: provider-history continuation, scalable monetary claims beyond the existing limits, React controls and linked consumer acceptance remain open in BTS-171/BTS-172. This evidence does not claim those requirements complete.
