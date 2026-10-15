# Recipient transfer funding receipt evidence

Source: 6bed7adebf24d5bb3bb82e397d9c068f70cd86d2, rebased on main 0.18.0.

- All 15 repository gates passed, 74.2% coverage. No policy, budget or floor changes.
- 39 focused tests passed across three files, including 26 receipt cases plus 13 existing payout-policy cases. Tests cover identity/provenance, pending/future credit, signed reversals and exact primary refund debits, pending-debit pairing, FX settlement receipts, conflicts, changing snapshots, overflow, provider errors and all 205 receipts across three provider pages. Request exhaustion never publishes partial totals.
- Red logs document missing reader behavior, missing financial guards and incorrect pending reversal treatment before implementation/correction. A full pending reversal cancels the matching pending credit; it does not invent debt against unrelated mature earnings. Already available debits remain signed debt.
- Real read-only GA Endive sandbox, public BetterStripe.payoutPolicy.transferReceipt and deployed transfer ledger: a real $40.14 transfer remains entirely pending with matureNet=0. A fully reversed $72.80 transfer with its two actual recipient refund transactions nets to totalNet=0, matureNet=0, pendingCredits=0. Exact provider receipt IDs and availability/status are captured.
- Foreign recipient identity was rejected. A one-request budget returned history_incomplete without totals. No financial writes, new fixtures, charges, transfers or payouts were made.
- FX and 205-row cases are deterministic test fixtures, not claims of live FX transactions. The real provider proof is USD.
- This reader supplies received-credit observations only. It does not allocate previous payouts, prove still-unpaid entitlement, adopt existing balances, enforce payout minimums or execute payouts. Those remain in the parent release/adoption work. Source transaction fields use Unix seconds; observedAt uses milliseconds.

Credentials are loaded privately into process memory and excluded from artifacts. No UI change; backend/package tests and actual provider output replace video evidence.

Final review added a failing regression for reinstatement source metadata changing between provider reads. The final fingerprint checks that provenance field too. All gates, focused tests and read-only real-provider checks above were rerun on 6bed7ad.
