# Currency-scoped payout source verification

Tested source: `68d836e`, based on release 0.28.5.

The RED tests reproduce a source receipt scan lasting 35 seconds: preview returns held and release throws a stale-observation error even though the final complete Stripe-history verification matches. The foreign-currency regression also detects unrenewed selected-currency observations.

The fix renews only the selected currency after the existing complete provider-history verification succeeds. It requires matching independently fetched receipt fingerprints, complete membership, current balance and a stable history head. It preserves local source fingerprints and the 30-second freshness guard for the currency being paid. Other currencies retain their original receipt times.

105 focused tests passed across seven files, including:
- A delayed complete history qualifies a $10 preview and creates/reconciles one $10 payout.
- Changed fees/net, missing history, partial pages and pending-to-available changes do not renew verification or create a claim.
- USD renewal leaves EUR proof time unchanged; the same proof qualifies and reserves only $10 USD, with an exact attempt marker.
- A local reversal change after renewal still rejects the assessment.
- Existing history-head, current balance, unknown outcome, deadline, worker retry and reconciliation safeguards pass.

These are deterministic component/client tests with provider fixtures and a simulated clock advance. No new live Stripe transaction or browser flow was run for this backend change. Prior live payout evidence on PRs #214, #216 and #218 remains separate. This does not remove the 100-row financial snapshot limit or complete the parent payout/Dojo requirements. All 15 repository gates passed on the tested source (77.4% line coverage); see `repository-gates.txt`.
