# Combined payout preview evidence

Source revision: `c3bd8a7a99aa5dc6c1038c4fff69dc93dfa9288a`.

The compiled package ran against a separately named local Convex backend and real Stripe sandbox recipient. The provider key stayed in child-process memory and is absent from these artifacts. This proves package/provider integration, not a deployed cloud cron or live-money bank delivery.

- `repository-gates.txt`: all 15 gates passed on this revision. Coverage is 76.7% lines. Existing coverage, file-size and Shadscan floors were unchanged.
- `isolated-deployment.txt`: the compiled component successfully deployed on the dedicated QA backend.
- `stripe-sandbox.json` and `.txt`: preview at 999 cents held below the 1000-cent threshold. Independent liabilities of 100 cents reduced entitlement to 899. After adding one cent, seller 599 and affiliate 401 combined to qualify for 1000. Previews created no bank payout or reservation. The persisted automatic worker paid exactly 1000 once; a post-payment preview reported zero unpaid entitlement without another payout. Duplicate worker invocation was held until its next due time. Original weekly schedule was restored and the isolated recipient was closed.
- `stale-observation-red.txt`: the empty-account stale-observation regression failed before its fix. The current focused suite has twelve passing tests, including pending funds, shared fees, recovery debt, insufficient supported-rail availability, drift and paid-commission refunds leaving negative affiliate entitlement.

Scope remaining: React/example settings and progress UI, larger-account provider continuation and scalable claims, actual linked Dojo/Fumadocs adoption. No ticket completion is claimed by this evidence.
