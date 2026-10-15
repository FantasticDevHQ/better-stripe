# Combined recipient release: final evidence

Final source: `f11de59de4f86e656d6377479fc3fc6decafc7b5`.

- `gates.log`: all 15 repository gates passed; 75.2% line coverage. No gate limits weakened.
- `focused-tests.log`: 59 tests passed, including immutable bank destination binding and rejection of a mismatched receipt.
- `success.json` / `success.log`: real isolated Stripe sandbox account, public `payoutPolicy.release()`. $6 creator source stays below the $10 threshold; adding $4 affiliate source qualifies together. Exactly one $10 payout paid. Replaying the operation creates nothing; a new operation does not reuse paid funds.
- `failure.json` / `failure.log`: same combined automatic release against Stripe's official insufficient-funds bank fixture. Actual `insufficient_funds` outcome, mature $10 return receipt, allocations released once. Test funding reversed only after the verified return.
- Both final-head scenarios restored the original payout schedule and closed the isolated QA account. The successful bank payment was not reversed or recovered; it was test money.
- Each JSON includes an additional read-back of the persisted claim, proving the exact bank destination, creator/affiliate allocations and final status match the provider receipt.
- `sandbox-harness.ts`: executed harness with local import paths made portable. Requires Bun, authenticated Convex CLI, the configured example sandbox and a built/mounted package. It injects the sandbox key in memory and does not print it. Run from the repository root; `BETTER_STRIPE_QA_BANK_FAILURE=1` selects the failure scenario. Static identity/bank fixtures are official sandbox test data, not customer data.

No UI changes. Historical adoption, resumable collection beyond current atomic bounds, additional debit/debt integration and recurring/UI/consumer adoption remain open under BTS-171/BTS-172/BTS-133. Earlier evidence under `payout-release-e2ad7f2` is superseded by this final-head evidence.
