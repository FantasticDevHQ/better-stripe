# Funded payout activation evidence

Final candidate source: `c212ba2c851891616e89a8715c529f9ca09223b0`.

- All 15 repository gates passed; 75.6% line coverage. No gate limits changed.
- All 89 focused tests passed, covering historical import, atomic allocation snapshots, historical funding maturity, paid/returned payout reconciliation, holding age, funded activation, delayed source/history changes, expired holding periods and zero-balance past payout history.
- Red logs demonstrate missing behavior before implementation.
- Backend/package changes; no UI changed.

The final-source isolated sandbox scenario passed. `sandbox.json` and `sandbox.log` demonstrate:

1. A real $10 test manual bank payout without a package claim marker was imported with explicit $6 creator + $4 affiliate source allocations. Replay created no payout.
2. $3 later creator funding and a $1 reversal from the already-paid affiliate source left $2 owed, exactly matching Stripe's $2 available balance. The old $10 stayed recorded as paid.
3. Public funded activation verified the complete history twice and anchored the holding deadline to unpaid funding age. It changed the verified original weekly schedule to manual.
4. Public `payoutPolicy.release()` created one new $2 bank payout. A later scheduled operation held with zero mature unpaid entitlement. There were exactly two payout creations overall: the initial historical test payout and this $2 release.
5. The original weekly automatic schedule was restored and the isolated QA account closed with no remaining funds. Both paid bank transfers were test money and were not recovered. The $1 reversal represented the refund scenario, rather than recovery of a completed bank payout.
6. Additional mounted-component read-backs after cleanup verify the original historical claim, new paid claim/bank destination and restored policy. They are included in the JSON.

The executed harness has portable import paths. It requires Bun, authenticated Convex CLI access, a configured sandbox and a built/mounted package. It waits for actual recipient transfer-capability readiness before funding, injects the sandbox key in memory and does not print it. Static identity and bank fixtures are sandbox data, not customer data.

No complete BTS-171/172/133 acceptance is claimed: resumable large-account history, additional debit/debt integration and recurring/UI/linked consumer adoption remain open.
