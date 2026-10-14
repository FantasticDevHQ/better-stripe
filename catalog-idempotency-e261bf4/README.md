# Retry-safe catalog creation

Source commit: `e261bf46d6baf5e5210be6eacc989e32f29b23c8`.

The regression failed before the fix because retrying a product create after component persistence failure created two provider objects. The fixed public methods forward optional caller idempotency keys to Stripe request options, preserve the omitted-key call shape and retry component upserts using the same provider result.

- [36 focused tests](focused-tests.log) passed, including a real isolated convex-test component store.
- [15/15 repository gates](gates.log) passed with unchanged floors/budgets and 69.8% line coverage.
- [Live sandbox results](live.json) and [log](live.log) passed against actual Stripe APIs. Database failures were injected only at the persistence boundary. Retried product/price requests returned the same provider IDs, a new version key created a distinct immutable price, and the authoritative existing subscription retained its original $9 price after creation of a $49 version. No charge was created; the trial, catalog and prices were cleaned up.
- [Pre-fix regression](red.log) demonstrates the original failure.

The [sanitized live harness](live-harness.ts) uses `<repo>` as the source checkout placeholder and requires securely injected `STRIPE_SECRET_KEY` plus an expected `STRIPE_SANDBOX_ACCOUNT_ID`. No credential values or private merchant IDs are included. Sandbox customer history remains for audit; the component store was isolated and temporary.
