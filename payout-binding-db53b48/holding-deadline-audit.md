# BTS-187 requirement audit

Audited current source `db53b48767e4de478f6dbfedcf046021c6be9a66` after the merged deadline, recovery, rejection and freshness fixes. This audit covers the deadline slice, not completion of its parent payout/consumer work.

| Requirement | Current evidence |
| --- | --- |
| Country holding window and verified age; no extension | `payoutPolicy/helpers.ts` uses 10/730/90 days, consistent with Stripe's manual-payout documentation reviewed October 16. Empty activation starts a conservative deadline before any new funding; funded activation uses verified `oldestUnpaidFunding` and preserves the prior deadline. Age/adoption/policy tests run in the full passing gate suite. |
| Final scheduled attempt below application minimum, preserving money constraints | `payoutDeadline.test.ts` verifies final-day 999/1000, unchanged minimum, liabilities, verified refund/reversal receipts, zero available entitlement, unknown outcome and provider floor/balance rejection. Public sandbox evidence on PR214 records one actual paid 999 payout. |
| Preserve unknown outcomes and actionable unresolved expiry | Policy tests cover retained unknown claims, missing provider observations, currencies, pending funds and stale observations. PR216 sandbox evidence shows actual 999 remaining after weekly restoration, unresolved UI and refused reset. PR218 records a genuine `balance_insufficient` rejection and actionable UI in both modes. |
| Restore intended automatic schedule idempotently | Policy tests cover unknown writes, lost recovery persistence and concurrent expiry. Sandbox evidence on PR214/216/218 records actual weekly Monday restoration and owned-recipient cleanup. |
| Exact-money and real supported sandbox evidence | Full current repository gates pass. Prior sandbox flows use real transfers/payouts/reversals; private deadline-shortening fixtures are explicitly disclosed. PR222 additionally proves the real five-minute cron, 205 sources, 101 prior paid claims and exact 150 remainder with no clock fixture. |
| Reusable UI, migration/docs, gates, public evidence | `PayoutProgress` and `PayoutAttemptStatus` preserve expiry/rejection distinctions; example projection and reset tests pass. README, settlement and migration guides document deadlines, legacy recovery, unknown outcomes and provider restrictions. All 15 gates pass. |

Sources: [Stripe manual payouts](https://docs.stripe.com/connect/manual-payouts), [automatic payout schedules](https://docs.stripe.com/connect/manage-payout-schedule).

Prior public evidence: [funded final window](https://github.com/FantasticDevHQ/better-stripe/tree/4c9d0c8/payout-deadline-8968474), [unresolved expiry](https://github.com/FantasticDevHQ/better-stripe/tree/3516d3d/payout-expiry-recovery-aabb797), [actual balance rejection](https://github.com/FantasticDevHQ/better-stripe/tree/e4f17c8/payout-attempt-f2536dd).

Limitations remain explicit: country rules are not a guarantee of bank arrival; unavailable provider floors/capabilities stay held and require operator recovery. The recordings do not simulate years of provider-held cash or all-country execution. Historical adoption above 100 rows is tracked separately in BTS-191. Linked Dojo adoption and the parent payout requirements remain open.
