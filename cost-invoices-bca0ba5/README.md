# Invoice recovery verification

Final source: bca0ba5cc79e89bf0e3d8d6b6890253b21714f35, PR159.

- gates.log: all 15 gates passed, unchanged coverage floor, 71.4% lines.
- focused-tests.log: 27 tests across public client, real component and SDK transport. Includes the final completed-group guard regression.
- authorization-and-completion-sandbox.json: real Stripe sandbox and deployed Convex component at the final source. Invoice-owner/currency mismatch and completed-group attempts created zero provider items. Test claims closed and draft invoice removed.
- lifecycle-sandbox-ec4119b.json: real sandbox lifecycle at ec4119b8baa2f82babcda9e02f31c211416900d5 before the added guard. A subsequent database failure was injected after successful Stripe item creation. Recovery found that item beyond 105 padding items, and retries kept exactly one adjustment. Paid invoices collected once; void invoices restored the outstanding obligation. A negative credit item was accepted. Half of a 1,220-unit funding charge was refunded, producing a separate 160-unit rollback against a 320-unit recovery. The final source adds only a guard preventing NEW creation for already completed groups plus its regression test; these lifecycle paths continue to use sealed groups for creation.

Fixtures use a host-approved synthetic original cost claim, actual customer accounts, invoices, card payments, invoice items and refunds in the non-Connect sandbox. No live-mode operations were used. Successful test funding was fully refunded after assertions and no test invoices remain open. Historical recovery audit rows and the negative-invoice customer credit remain in isolated QA scopes; no recurring subscriptions or automatic collection jobs were created for them.

Harness files are sanitized copies with repository paths replaced by /path/to/better-stripe. They show the assertions and cleanup sequence. Secrets were read into process memory through Convex environment lookup and never printed or saved. They require the corresponding sandbox/development deployment and an explicit local repository path before rerunning.

This is backend/package work; logs and API outcomes are the relevant evidence. No UI changes were made.
