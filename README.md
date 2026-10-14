# BetterStripe settlement and billing API evidence

Implementation: `783f0b2c33a76abc39cbc792b2dec858436cc00c` on `codex/public-settlement-and-payout-apis`.
Environment: localhost Vite example, Convex development deployment, Stripe sandbox only.
No live keys or live payments were used. Financial outputs contain sandbox object IDs.

## Passing checks

- `VITEST_MAX_WORKERS=4 pnpm run check:all`: all 15 gates passed (gates.log). No floors, budgets, timeouts or policies were lowered. The final exact-head local run passed all 15 gates in 442.4s (local-gates-head.log). Exact-head GitHub CI also passed all 15 gates in 107.3s: https://github.com/FantasticDevHQ/better-stripe/actions/runs/38551745469 (ci-gates-head.log).
- Focused package tests: verified processing costs, allocation rounding/caps, immutable transfer claims, provider-success/persistence-failure recovery, legacy ungrouped transfers, refund recovery, commission selection, payout pagination and unavailable-account states.
- Account/Checkout idempotency: concurrent provider account reuse; recovery after persistence failure; different-order keys; parameter conflicts; stable React request IDs through retries/rerenders; storefront forwarding.
- Real sandbox Checkout action called twice with the same request ID returned the same session. Public package authoritative reads verified expanded product and paid subscription invoice; missing coupon preserved resource_missing/404. Payout snapshot returned a real next cursor. See sandbox-contracts.json.
- Two custom subscription checkouts settled at 10% commission. A Stripe test clock produced paid renewals: One-time affiliate 0, Forever affiliate 445 minor units; actual processing and transfer totals reconcile. See sandbox-renewals.json.
- Seller and affiliate payout API/Components cards match in content and geometry. Videos attached.
- New reachable `/demo/allocation` uses public allocateSale and React SplitBreakdown: creator 5460, affiliate 1820, collaborator 1820, inclusive fees 900 minor units. Video and screenshot attached.
- Admin commission-label browser test passed on isolated rerun. Initial navigation timed out during concurrent checks; both logs are included.
- React Doctor: 86/100, two sequential-await warnings in financial ledger execution/recovery. Those writes intentionally preserve serial recovery behavior.

## Resolved failures

The first preview test proved the old URL redirected to Stores. The preview now has its own route linked from Testing Utilities; the current browser test passes. Two export tests timed cold barrel compilation inside the assertion window; imports now run during test setup with the same export identity assertions. No test timeout was increased.

## Capability limitation and remaining work

Both audited sandbox recipient accounts use daily automatic payouts. Balance Settings exposes no numeric minimum payout floor. A retained minimum balance is not a payout trigger. No threshold setting or payout schedule was changed.

The provider-managed default keeps no additional application minimum. Custom threshold enforcement (BTS-133) remains pending the choice of platform-retained payables before transfer versus a controllable manual bank-payout schedule with automatic releases. Below/exact/above numeric provider-floor tests are explicitly unavailable, not simulated or claimed passed. See payout-boundary.json and package docs/settlement.md.

Videos are Playwright recordings. Structured assertions are in annotations.json and test logs; the recordings have no in-video annotation overlay. UI recordings precede the final test-only export setup change and show the current visual behavior.
