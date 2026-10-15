# Full example payout lifecycle verification

Final commit `185b816` includes the reset, recipient-operation identity and component-pagination fixes. All 15 repository gates passed with 77.2% line coverage. Forty focused tests passed across the example and component suites. React Doctor reported no changed-file issues, score 85/100. Authoritative library/example codegen and the development backend deployment completed.

## Bugs reproduced

- The public Admin reset deleted app owner rows before the component rejected an unsafe custom schedule. The registered-action regression showed the owner row was null after refusal; the CLI path already preserved it.
- Replacing a persona's recipient account collided with its old settings operation ID. `account-collision-before.png` and the failing regression show the error. New operation IDs include the resolved account; pending retry still uses the stored operation.
- Actual scheduled scans failed with `paginate() is only supported in the app`. The previous convex-test behavior allowed those unsupported calls. The new test boundary reproduces the deployed restriction; all ten remaining native callsites now use the official component-compatible paginator. Existing multi-page reads and local collection semantics remain covered.

## Actual application and Stripe sandbox proof

The QA backend was explicitly named `anonymous-better-stripe-payout-worker-local`, with its project-local state and the full example backend. The actual example frontend used that backend on an isolated port. There were no mocked action or Stripe financial responses. QA resets affected only this local backend. Tests used disposable recipient accounts within the configured Stripe sandbox; existing demo recipients were not reset or reconfigured.

The activation segment was recorded at `70be8da` before the component pagination fix. It proves browser consent, verified manual scheduling, real 599 store + 400 affiliate minor-unit carry forward, and qualification after one more affiliate unit. It then reproduced the failed scheduled scans, so it is **not** a passing payout test. The readable clip ends at 45 seconds after those assertions; the full original retains the failed observation window.

After deploying the pagination fix now committed as `185b816`, the installed five-minute cron created exactly one real 1000-unit payout. `provider-results.json` records the paid receipt and completed worker generation. `scheduler-before.json` shows the failed scans; `scheduler-after.json` retains both the subsequent successful scans/attempt and earlier failures. No direct SDK bank-payout release was used by the QA controller. A second actual dispatch produced no duplicate payout.

`reset-readable.webm` is the passing post-fix browser recording. It verifies the paid UI, refusal of reset with owner binding and custom policy preserved, browser opt-out restoring the original weekly schedule, successful reset clearing app/component records only afterwards, and core persona reseed leaving the cleared policy absent. All five assertions passed with no page runtime errors. Both disposable recipients had their original schedules restored and were closed with zero balances and no in-flight payouts.

The readable videos crop only empty capture padding to the active 800x556 region and scale it to 1440x1000. No test actions are removed from the reset recording. Full-resolution screenshots and original captures are retained. Test harness selectors and role initialization were corrected before the passing recording; those corrections changed no financial data.

## Limits still open

Core persona reseed is verified, not full catalog/subscription/activity fixture repopulation. Holding-deadline expiry still needs its dedicated provider lifecycle verification. Actual refund/dispute and insufficient-provider-balance scheduled scenarios, larger provider-history qualification/atomic claims and linked Dojo/Fumadocs adoption remain unfinished. This PR does not certify those items or live-money bank delivery. Cached cursors must restart after the reader upgrade; financially bound state must never be erased to restart a scan.
