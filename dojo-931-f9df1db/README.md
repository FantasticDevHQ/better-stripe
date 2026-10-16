# Dojo automatic payout screen evidence

Source `f9df1db4923161ffebfe42892020af4c93630e31`, branch `codex/dojo-931-automatic-payouts`. Actual Dojo components/styles and public BetterStripe 0.30.0 React workflows. Browser session/provider transport is mocked and clearly captioned; no financial operation occurs.

Recorded browser assertions pass: private error hidden; explicit retry; USD/JPY/HUF balances retain their original units; next reported payout/UTC arrival and bounded upcoming preview; load-more appends previous payouts and terminates at the cursor end; 390px layout has no page overflow; zero, empty, not-ready, foreign cache and changed-user states remain distinct. Screenshots were visually reviewed.

Seven backend regressions use real BetterAuth/BetterStripe schemas with a mocked provider snapshot. They cover the authenticated account, bounded pagination, anonymous/foreign/org and disabled/deleted callers, mapping changes during reads, safe failure and retry. Provider creation/provisioning is not invoked. Seven React tests use the real public workflow. Red logs precede the new implementation. Read-only Convex code generation and both backend/web type checks succeeded.

Full repository gates and CI are pending at this evidence upload. These fixtures do not prove hosted bank setup, Dojo deployment or actual bank delivery. DOJO-2249/2250 retain custom minimum configuration and progress.


## Actual Stripe sandbox adapter read

Final backend test/docs commit `994969e91` retains the exact UI recorded above. The opt-in actual-provider test passes at that commit in 12 seconds. It uses the real Dojo adapter with isolated BetterAuth/component state and the configured Stripe test-mode transport. Only the provisioning idempotency key is namespaced for a fresh QA run. The report records account creation/reuse, real hosted-link generation, a ready owner-bound empty payout snapshot, and verified account closure. Credentials are injected in memory, never included in this evidence. No payout or payment is created. No claim of completed hosted bank verification, cloud adapter deployment or bank delivery is made. Final full gates/CI remain pending until recorded in the PR.


## Final documentation review and gates

Head `136f746d1d424408b93fe9437f5e8d6b9c8fc4ba` adds seven JSDoc comments only. A TypeScript AST check confirms all nine reviewed exported UI/fixture functions are documented. Seven focused React tests still pass. All 12 local gates pass on this head in 190.1 seconds: 4,642 backend tests, 7,718 web tests and 32 UI package tests passed, with existing skips unchanged. Preceding source-tree head `5edb47c8c69364feb705ce1d411870ef5fc034c5` also passed independent CI run 38844711795. A final exact-head CI run is being recorded in PR734 before merge. The same video/screenshots and sandbox read apply because the follow-up changes only comments.
