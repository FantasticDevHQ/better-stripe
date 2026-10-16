# Platform payout-minimum editor verification

Final Dojo PR #736 head: `dc396d70ea8d7e8a8c31f2a333028719c31badde`.

All 12 repository gates pass on the final head in 211.5s using the repository-pinned Node 24.19.0 through fnm. Backend: 4,668 passed with one existing skip. Web: 7,742 passed with four existing skips. UI package: 32 passed. The preceding Homebrew run lost a shared library during worker startup and is not counted as a pass. No rule or baseline was weakened.

All 24 focused React tests, 26 real-schema backend tests and both browser runs pass. The videos show the actual Dojo Shadcn form and public BetterStripe action lifecycle, with clearly labeled synthetic auth/database transport. Desktop and mobile screenshots and recorded frames were inspected. Runtime recording head `85cec13e251e2b9fd53a69136b821ec901f98d6c` is unchanged in production on the final head, which adds only seven JSDoc comment lines in three test/fixture files.

Tests cover explicit provider defaults, integer minor units, independent USD/JPY settings, retry identity, duplicate-submit locking, private errors, fresh nonce/session handshake, obsolete nonce/session/revision disposal, server-bound editor saves, revoked backing sessions, accessible radio/error associations and sign-out removal. Existing authorized programmatic callers can omit the optional editor-scope comparison. The red logs establish the missing UI, session and accessibility behavior before their fixes.

CodeRabbit reviewed the runtime implementation with no actionable code findings. Its docstring coverage warning is fixed: a TypeScript AST audit verifies 21/21 reviewed named functions have JSDoc. React Doctor reports 92/100 with one advisory about form preventDefault; the client mutation intentionally stays on the current page. Greptile review is unavailable because its trial expired.

Browser transport is mocked. Backend tests use real Dojo/BetterAuth schemas in isolated in-memory fixtures. Explicit Dojo-dev read-only code generation passes. These tests do not certify cloud deployment, actual app sessions, Stripe schedule changes, recipient consent or payout release. No shared anonymous database was used. Financial activation/progress remain DOJO-2249/2250.

Final exact-head CI is being verified before merge: https://github.com/kellykampen/dojo/actions/runs/38851902086
