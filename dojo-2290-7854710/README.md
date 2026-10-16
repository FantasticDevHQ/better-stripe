# Audited payout minimum configuration

DOJO-2290, Dojo source `7854710346d90283d2b6eee8b89ab77443ca90eb`.

The isolated auth/schema suite passes all 20 tests. The red log records four positive contract failures before the configuration module existed; negative rejection cases alone were not evidence that authorization existed. The green run exercises the implemented methods against real Dojo and BetterAuth schemas.

The API persists versioned per-currency intent and an append-only admin audit. Lost-response retries do not create duplicate revisions. Concurrent edits cannot overwrite a committed revision. Recipient reads expose no audit identities. Unknown numeric provider floors are not invented.

No Stripe operation or bank payout is performed. This evidence does not certify a cloud deployment, native Convex runtime, custom-policy activation or admin UI. No shared anonymous database was used.

All 12 local repository gates passed in 262.5s. Backend 4,662 passed with one existing skip; web 7,718 passed with four existing skips; UI package 32 passed. Existing lint warnings remain unchanged. The exact-head manual CI run is being verified before merge: https://github.com/kellykampen/dojo/actions/runs/38847810000
