# Payout reconciliation and fee evidence

Final source commit: `976199abace93c41e18900331a468825479f0c1a`, rebased on main `2ff4be1`.

- [Focused tests](focused.log): 161 passed across eight files. Covers receipt binding/maturity, bounded discovery, ownership, concurrent reconciliation, unknown outcomes, original fee immutability, signed return fee credits, legacy fee evidence, and eligibility after liabilities/fees.
- [Repository gates](gates.log): all 15 passed; 75.0% line coverage. Existing policy, coverage/Shadscan floors and budgets were preserved.
- [Mounted deployment](deployment.log): the rebuilt example component was deployed and its fee query invoked before financial fixtures. Development endpoint identifiers are redacted.
- [Successful payout](successful-payout.json) and [log](successful-payout.log): one real sandbox $10 payout created through BetterStripe. A simulated recording outage left the claim reserved. Reconciliation discovered the exact provider payout, recorded it paid once, and replay created no further payout. Original schedule restored; QA account closed.
- [Bank failure](failed-bank-payout.json) and [log](failed-bank-payout.log): one real sandbox $10 payout failed with bank-side `insufficient_funds`. Its actual available return transaction verified $10 principal. Reconciliation released the reservation once. Test funding returned to the platform, original schedule restored, QA account closed.
- [Read-only receipts](read-only-receipts.json) and [log](read-only-receipts.log): final-head public reader verified existing automatic and manual paid payouts through scoped Stripe balance transactions.

Both write scenarios ran on the exact final source above. No customer charge was created. These are isolated Connect sandbox fixtures, not live bank payments. Each scenario created exactly one payout; test financial records remain auditable after account closure. The successful paid payout was not represented as a recovered bank payment. The failure scenario returned its funding transfer. Standard sandbox payout fees were zero; nonzero fees, fee credits and over-credit holds are covered by deterministic component/client tests, not claimed as live charged fees.

The [harness](harness.ts) uses a private in-memory CLI environment read, asserts a sandbox secret and sandbox recipient, and creates its own recipients. To reproduce, copy it into a configured repository, build and deploy the example component, then run with Bun from the repository root. Set `BETTER_STRIPE_QA_BANK_FAILURE=1` for the failed-bank scenario. The repository path can be supplied as `BETTER_STRIPE_REPO`. Bun is a verification tool, not a package runtime dependency. Only public Stripe test identity/bank values are included; no secret credentials or real bank details are attached.

The initial stale local deployment was caught before any payout creation; its QA funding was reversed, schedule restored and recipient closed. The README now explains build, mount and runtime-preflight ordering. Positive evidence here is from the corrected deployment.

This PR reconciles outcomes for already attempted claims. It does not finish automatic qualification/creation, historical source adoption, large-history collection, other account debit allocation, recurring release/expiry jobs or UI integration. BTS-171/BTS-172/BTS-133 stay open. Global Payouts requires its own receipt/capability implementation.
