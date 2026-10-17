# Balance-funding verification

Candidate: eaa8c2c214d73f5ee49d76df8b005a2293d02f85, based on main 4c36a70.

- Focused example migration/workflow suite: 24 passing tests.
- Real Stripe SDK with synthetic HTTP transport and actual nested component Workflow/Workpool. Covers duplicate intents, enable/disable keys, lost apply response reconciliation without a second write, legacy unknown receipt gating, exact restoration, worker-drain attestation, bounded backfill/replay/counts, stale account and rollback guards, abandoned observer recovery.
- Native codegen/typecheck/push on isolated BetterStripe SQLite backend4470 passed. Empty backfill start/step/replay passed with zero provider calls.
- UI recording at4d702ee uses the same unchanged StorePaymentSource UI as this candidate. Actual example component and package hook with synthetic state transport. Consent, disabled pending controls, held warning and same-target retry presentation passed. This is presentation evidence, not a live Stripe checkout/renewal test.
- No live provider, production deployment or existing database migration occurred.

Final review head: 1a1bec5215786812734cfe4be0e8027f793c5cb3. The last commit only raises automatically ratcheted coverage floors.
Full repository check: 15/15 gates passed, including coverage and Shadscan.
