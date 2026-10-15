# Historical payout import checkpoint

Source checkpoint: `554b3f847edb7327d5e6611be498aae7adbd0ff9` on `codex/recipient-payout-adoption`. This is unfinished adoption work, not a release or completed funded-account activation feature.

- All 15 repository gates passed; line coverage 75.5%. All 45 focused tests passed.
- Explicit historical source allocations are validated against maturity at the payout date and imported atomically with actual payout fees. Competing mappings and partial/invalid batches cannot mix their writes. An adopted historical payout can reconcile later without pretending that it originally carried a BetterStripe claim marker.
- Real isolated sandbox proof: one $10 manual bank payout with no package claim was imported and replayed without creating another payout. After $3 new funding and a $1 reversal from a paid affiliate source, the $10 historical allocation remained paid; mature received money was $12, unpaid entitlement $2, and actual Stripe available cash $2.
- Cleanup returned only remaining test cash, preserved the original automatic schedule and closed the QA account. The successful $10 test bank payment was not recovered.
- The first fixture attempt stopped before funding because the recipient transfer capability was still activating. No payout was created, and that account closed cleanly. The retried harness checks actual capability readiness before funding; production adoption code was unchanged.
- The harness has portable local imports and injects the sandbox key privately in memory. It requires Bun, configured Convex CLI access, and the built/mounted example package. Identity/bank fixtures are sandbox test data, not customer data.

Still required before a PR: fresh adoption proof for funded-account activation, delayed-attempt validation, retention-deadline anchoring, and documentation. Larger-account collection and recurring/UI/consumer adoption also remain open. Do not bypass `migration_required` or advertise custom activation as complete from this checkpoint.
