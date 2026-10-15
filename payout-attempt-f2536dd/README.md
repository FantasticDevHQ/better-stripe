# Automatic payout rejection evidence

Source commit: `f2536dd` on `codex/payout-attempt-status`, based on release 0.28.4.

A fresh Stripe sandbox recipient qualified with $5.99 store + $4.01 affiliate funds and a $10 custom minimum. A private scheduled action wrapped the real SDK payout call to reverse the real funding after qualification and before sending the immutable payout request. Stripe returned `balance_insufficient` with request ID `req_YwNVHbii1Zu5yV`. No provider response or financial amount was mocked. The race hook and disabled recurring payout cron existed only in the isolated QA deployment; they do not ship. No holding-deadline timestamps were changed.

Passed checks:
- Mature source rows were $5.99 store + $4.01 affiliate before qualification.
- The active worker showed an unverified running attempt and hid stale retry timing.
- Genuine rejection was persisted with the result timestamp and next attempt five minutes later; the terminal claim released its reservations.
- Both via API and BetterStripe components showed the same actionable rejection, timestamp and retry context. Full-page screenshots include the retry information below the fold.
- An immediate replay returned `not_due` with the same next-attempt time.
- Opt-out restored the original weekly Monday schedule. Fresh Stripe reads verified zero available/pending balance and no payouts before closing this sandbox recipient.

The native browser video records the actual flow; it includes provider waits and is captured at 800×562. Use the full-page PNGs for readable detail below the viewport. Initial setup also confirmed that activation refuses an existing funded balance; that funding was returned before activation and the recorded qualification used fresh transfers.

Validation: all 15 repository gates passed, 77.4% line coverage; 31 focused package tests and 14 example-action tests passed. Typechecking and lint passed. React Doctor found no issues (90/100). The repository-wide gates ran in a clean checkout to exclude pre-existing untracked QA files from formatting.

This evidence proves one real provider balance-race rejection and UI projection. Provider minimum rejection, generation replay, legacy timestamp handling and stale-result suppression are covered by focused tests; they were not all exercised against live Stripe here. Prior funded deadline and expiry recovery evidence remains on PRs #214 and #216. This does not assert completion of every parent payout requirement or linked consumer adoption.
