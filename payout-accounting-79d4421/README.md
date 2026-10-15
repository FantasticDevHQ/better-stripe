# Payout accounting verification

Commit `79d4421fefb099041ca08af66e1c3aa22b89efb7`, based on main v0.27.0.

## Actual provider verification

`provider-results.json` records the compiled package against a disposable US Stripe sandbox recipient and an explicitly named isolated local Convex backend. No live-money account was used.

- A combined 999 minor-unit balance remained below the 1000 minimum, with 999 carried forward.
- A separate read-only assessment with 100 units of host liabilities withheld 100 and carried forward 899. This verifies the liability input, not automatic collection of that debt.
- One additional unit qualified 1000. An early worker call remained not due. The persisted due attempt created exactly one payout.
- The verified paid payout reported 1000 paid principal, zero reserved, and source totals of 599 store plus 401 affiliate.
- Replaying the attempt did not create another payout. The original weekly schedule was restored and the zero-balance QA recipient was closed.

## UI presentation verification

The video and screenshots render the **actual example PayoutPolicyPanel and package PayoutProgress**, using the recorded real sandbox assessments above. A temporary presentation adapter supplies those captured responses in place of the Convex React action hook. It does not simulate Stripe financial receipts or claim to exercise the full application's authenticated server actions, cron dispatcher, activation, reset or expiry flow.

Card values, paid source rows, native unstyled package markup, light/dark appearance and 390px mobile width passed. No page runtime errors were observed in the final recording. Initial fixture setup had a Tailwind scanning issue; the fixture was corrected to compile the example's actual styles before the final recording.

`ui-original.webm` retains the original capture. `ui-readable.webm` crops only empty capture padding to the active 800x556 region and scales it to 1440x1000. No test actions were removed. Screenshots retain the full rendered page resolution.

## Checks and limits

All 15 repository gates passed from a clean checkout of the exact commit, including 77.1% line coverage and Shadscan. The active worktree's first format gate encountered three pre-existing untracked QA result files; these were preserved, and the clean committed-tree gate run passed. The 35 focused tests passed. React Doctor reported no issues in changed files, score 89/100. The example development deployment was updated and codegen regenerated.

Submitted-to-paid, verified payout returns, a commission refund after a paid bank payout, rail-capped carry forward, withholding caps, mixed currencies, corrupted allocation rollups and legacy previews are covered by deterministic tests. The actual provider run covers a paid sandbox payout, not a bank return or live-money bank delivery. Existing larger-history limits and linked Dojo adoption remain open in BTS-171/BTS-172.
