# Example recovery cutover evidence

Current source: c191ac1877d49064de0d414fc15e559c7329440f (rebased on main, package 0.16.0).

- All 15 repository gates passed; line coverage 73.5%. No policy, floor or budget was weakened.
- 50 focused tests in 10 files passed. Coverage includes bounded batches, original economics, source revisions, transfer failure/retry, safe pre-attempt cancellation, pending invoice bypass, paid/void invoice outcomes, funding rollback and totals beyond 100 itemized rows.
- Both combined renewal scenarios passed on the current deployed source. $9 plan + $16.47 actual refund/dispute costs = one $25.47 Stripe balance debit. Insufficient balance caused no debit/card fallback; new sale earnings funded a retry of the same invoice, collecting once. Test subscriptions were canceled. Stripe canceled the failed subscription through its configured recovery settings: paying the invoice did not reactivate it, and access correctly stayed closed.
- Real invoice funding refund: an actual $0.88 expense was paid through a $9.88 card invoice. Half refund reinstated $0.44; full refund reinstated $0.88 plus $0.59 uncovered processing cost, totaling $1.47 owed. This payment/refund proof was captured at 0d32842 before the rebase; two additional verified provider replays on c191ac1 kept exactly $1.47 owed. No test invoice is open; that isolated canceled actor deliberately retains the real obligation.
- ui.webm records actual seller Billing refresh and the package CostRecovery table. Screenshots show the same real sandbox history. The precondition was verified adoption of legacy rows, not mocked transport. Legacy inputs retain their prior labels until adoption.
- React Doctor: 90/100, one warning at saleRecovery.ts:46. The balance read must follow the reservation mutation to see the updated financial totals; parallelizing those awaits would be incorrect. All React and repository checks pass.

These are Stripe sandbox results, not live-mode charges. Test data contains fictional personas and sandbox provider IDs. Credentials are excluded; harnesses read test keys only into child-process memory. Hosts still own authorization, fee policy and explicit balance-payment consent. Unresolved legacy holds and ambiguous funding allocations fail closed rather than inventing collection.

Final source 1494b5798592f8e78a548bc2013dcf7a3649f31d removes only an unused example allocation helper and its two obsolete tests. Runtime recovery behavior and UI are unchanged from the recorded c191ac1 evidence. All 15 gates rerun and passed at 73.5% coverage; see cleanup-gates-1494b57.log.
