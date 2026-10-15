# Recipient-held payout policy evidence

Source: 2e7cd56511b756a1a7b1ee8e870d74d9b7e3e992, rebased on main release 0.17.1.

- 104 focused tests across four files passed. The new policy suite covers 26 cases; existing public payout/index tests cover the unchanged CreatePayoutOptions extraction. Red logs capture missing functions, safety guards and delayed activation before implementation.
- All 15 repository gates passed, 74.0% coverage. No policy, floor or frozen budget changed.
- Actual GA Endive Stripe sandbox, public BetterStripe.payoutPolicy client and deployed Convex component: persisted preparation left weekly provider settings unchanged; manual schedule update succeeded and an injected confirmation failure left the policy changing. Retry observed provider success and confirmed without another update. Threshold edits preserved the deadline; a deliberately changed live schedule produced schedule_drift; opt-out restored original weekly Monday settings.
- Final provider proof is after the rebase and restored deployment. Temporary account closed, original schedule restored, and no charges, transfers or bank payouts created.
- During QA cleanup, a wrong-directory backend removal briefly unmounted the example component. Tracked files were restored exactly from the committed head and the component remounted. Before any financial reconciliation, read-only checks confirmed the existing eight users and the original $1.47 outstanding funding-recovery obligation with zero reservations. environment-restoration.json records those checks. The final provider replay and complete gates passed afterward.
- Schedule/control APIs are the foundation only. No claim of automatic combined payout execution, existing-balance adoption, UI integration, or a numeric provider minimum is made. Those remain separate dependent work. A host recurring expiry job is required before activation in a production integration. Unsupported control, drift, permissions and mixed-balance limitations remain explicit.

No UI layout changed; backend test/provider receipts replace video evidence. All provider credentials stay in child-process memory and are excluded from these artifacts. The harness reads its sandbox key privately from the configured development environment.

Additional post-merge environment check: freshly loaded localhost Seller → Refunds rendered the existing cost rows and refund history. Browser console reported 0 errors and 0 warnings; screenshot and console output included. This is a restoration smoke check, not a claim of new payout UI coverage.
