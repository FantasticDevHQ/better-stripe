# Payout claim ledger evidence

Source commit: `376f22610a71cdcd8715904e04b79ff031eb6f80`.

- [Focused tests](focused.log): 84 passed. Includes 35 allocation cases, 23 transactional component cases, and 26 existing receipt cases.
- [Repository gates](gates.log): all 15 passed; 74.7% line coverage. No gate policy, floor, or existing budget was weakened.
- [Read-only Stripe proof](provider.json) and [output](provider.log): the existing public receipt reader still verifies real recipient funding after sharing its ledger fingerprint with the claim boundary. A real $40.14 pending transfer contributes zero mature funds. A fully reversed $72.80 pending transfer contributes zero mature funds and zero pending credit. The request budget fails closed and a foreign account is rejected.

The component tests exercise combined creator/affiliate allocation, below/exact/above thresholds, prior paid and reserved amounts, refund debt, currency isolation, competing workers, immutable replays, attempts held across uncertainty, accepted/paid/returned payout states, unique provider receipts, missing source rows, and recent proven create rejections. The red logs preserve the failed assertions that motivated receipt and missing-source guards.

No Stripe payout, transfer, charge, refund, or new sandbox fixture was created by this verification. The provider check proves the existing receipt reader, not bank payout execution. Claim arithmetic and transitions are verified with deterministic Convex tests, not live Stripe payout mutations.

This PR supplies trusted-server claim primitives only. Provider execution and payout receipt verification, historical ownership/adoption, a resumable collector beyond the 100-source bounded snapshot, payout-fee accounting, recurring release/expiry jobs, and UI integration remain open under BTS-171/BTS-172/BTS-133. Do not interpret this evidence as completed automatic custom-minimum payouts.
