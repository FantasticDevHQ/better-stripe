# Platform payout-minimum editor

DOJO-2292, Dojo source `85cec13e251e2b9fd53a69136b821ec901f98d6c`.

All 24 focused React tests, 26 real-schema backend tests and both browser runs pass. The recording shows the actual Dojo Shadcn form and public BetterStripe action lifecycle, with clearly labeled synthetic session/database transport. Desktop and mobile screenshots and video frames were inspected.

The tests prove provider-default presentation without a guessed floor, whole minor-unit validation, independent USD/JPY settings, immutable retry identities, duplicate-submit locking, private-error suppression, fresh admin-session handshake, stale nonce/session/revision disposal, accessible grouped controls and error associations, and sign-out removal. The red logs distinguish missing UI behavior, the missing server handshake and the missing group name before their fixes.

React Doctor reports 92/100 with one advisory about form preventDefault. That behavior intentionally keeps the client Convex mutation on the current page and is retained. No rule or gate was weakened.

Browser transport is mocked; backend persistence/authorization evidence is in merged Dojo PR #735. These tests do not certify cloud deployment, Stripe scheduling, recipient consent or payout release. Those remain DOJO-2249/2250. Current local gates and exact-head CI are being verified before merge: https://github.com/kellykampen/dojo/actions/runs/38850746170

Editor saves include the expected nonce-verified session scope. The server compares it with the current enabled admin before persistence or retry replay. Real-schema regressions cover correct, malformed and foreign scope, a replacement session and a revoked backing session. Existing authorized programmatic callers can omit this optional editor comparison. Explicit Dojo-dev read-only code generation passes; no shared anonymous database was used.
