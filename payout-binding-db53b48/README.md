# Paginated payout binding and versioned recovery evidence

Code tested: `db53b48767e4de478f6dbfedcf046021c6be9a66`, branch `codex/payout-collection-binding`.

All 15 repository gates pass, 77.5% line coverage. 143 focused package tests and 21 example tests pass. Original failing refund-cost race and final logs are included. React Doctor reports four warnings about sequential Convex indexed database reads; these remain explicit.

Live Stripe sandbox, isolated recipient only: 205 real transfers of 50 USD cents fund $102.50. 101 actual bank payouts of $1.00 are verified paid with exact debit receipts. Available balance is $1.50. Source allocations and historical claims are imported by a private test fixture into the copied component. This verifies larger-history execution, not the separately bounded public historical-adoption API. The fixture is not in the shipped package.

A real package worker call with `maxPages: 1` stops at collection step 25 with 205 sources and partial claim membership. It returns `collection_pending`, creates no payout and retains its operation. The unchanged production five-minute cron is restored to resume it. Final automatic payout/UI/cleanup evidence is still being collected; this document will be updated before merge.
