# Live non-Connect sandbox verification

Date: 2026-10-14. Source: `aefaca1717ae812c9f2146dc67703383538da2db`, merged by PR #141 as `e58905d1c588995cac55ae0f5b830f785ff65f75`.

The owner enabled the Accounts v2 customer preview in the existing non-Connect development sandbox. The test key and expected sandbox identity were checked before provider writes. Credentials stayed in process memory; no production deployment, Connect onboarding, merchant configuration, recipient configuration, transfers, or platform fees were used.

## Results

All 22 assertions in [results.json](results.json) passed against live Stripe responses and a real isolated `convex-test` child component store. This is not a deployed consumer-app acceptance test. The temporary local HTTP receiver was exposed through an ephemeral HTTPS tunnel. Stripe delivered and signed the events itself. Snapshot destinations were pinned to `2026-09-30.preview`; thin notifications are unversioned.

- Customer-only buyer provisioning, provider configuration verification and retry stability.
- Product and recurring/one-time price creation through the package.
- Embedded, custom, form and redirect Checkout Session creation, customer-account binding and stable idempotent retries. Embedded/custom/form payment submission was not exercised in this run.
- Hosted subscription Checkout paid with Stripe's successful test card; redirect to the test receipt and authoritative paid/complete session verification.
- Subscription, invoice, payment and customer lifecycle events processed through the package's signature verification and actual component mutations. 13 delivered events returned HTTP 200.
- Customer-account portal creation and display of the saved test card, billing information and invoice history. See [portal-check.json](portal-check.json) and [portal-loaded.png](portal-loaded.png).
- Cancellation and reactivation through package APIs, authoritative provider reads, and matching component updates through signed webhooks.
- Full refund through the package, authoritative succeeded status, and signed refund synchronization into the component store.
- Cleanup canceled the QA subscription, expired open sessions, archived the QA catalog and deleted temporary destinations. Earlier test-run payments were also refunded. Test history remains in Stripe for audit.

## Evidence

[Checkout and API billing recording](checkout-and-api-billing.webm) shows the successful test-card checkout and receipt, followed by portal navigation. [Receipt](receipt.png), [loaded portal](portal-loaded.png), and [run log](live-run.log) support the provider and component assertions. No live credentials, webhook signing secrets, checkout client secrets, or portal session URLs are included.

Earlier attempts exposed errors in the temporary test receiver and UI selectors. Those harness mistakes were corrected and the successful run repeated. They required no package source changes. The final evidence describes the successful run, not the aborted attempts.

## Reproduction

`reproduce.ts` is the sanitized ad hoc harness. Copy it to the repository root and run it using the example's `tsx` runtime. Supply `STRIPE_SECRET_KEY` through secure environment injection, `STRIPE_SANDBOX_ACCOUNT_ID` as the expected sandbox account, and `WEBHOOK_BASE_URL` as an ephemeral HTTPS tunnel to local port 4349. Never use a live key. The script creates isolated QA Stripe records and a local component store, then cleans up its active subscription/catalog/destinations. The package's permanent regression tests and CI evidence remain in the parent evidence folder.

Official preview support was published as 0.10.1 through PR #142. The cancellation normalization fix discovered during these tests is a separate follow-up and is not claimed to be in 0.10.1.

## Portal UI and discovered regression

The real Stripe portal cancellation reason/confirmation sequence and “Don't cancel subscription” renewal/confirmation sequence passed. Provider reads verified `cancel_at` was set and then cleared. See [portal action results](portal-actions.json), [portal cancellation and renewal recording](portal-cancel-and-renew.webm), [cancellation screen](portal-canceled.png), and [renewal screen](portal-renewed.png). The test fixtures were canceled/refunded and their catalog archived.

Stripe returned `cancel_at` equal to the billing-period end while `cancel_at_period_end` remained false. This exposed a package synchronization gap. The follow-up branch normalizes that timestamp in both webhooks and explicit synchronization. A regression test first failed against the old behavior. The extracted focused suite then passed four cases covering period-end timestamps, a different cancellation date, clearing the timestamp, and bulk synchronization. See [red test](portal-regression-red.log) and [focused tests](portal-regression-focused.log). Live verification of the follow-up commit is recorded separately when complete.

## Follow-up fix verification

Commit `6aaccee5d12df7800ae9213a4b30201dc209ed5f` passed a targeted live no-charge trial test. Stripe returned `cancel_at` at the billing-period end and a false raw boolean. The actual signed update normalized the stored flag to true. Package reactivation cleared the timestamp, and its signed update cleared the component flag. Explicit provider resends were also delivered and correctly deduplicated. All delivered snapshots used `2026-09-30.preview`. The temporary destination and trial/catalog fixtures were cleaned up. See [live follow-up results](cancel-sync-results.json) and [provider delivery log](cancel-sync-live.log).

[CI run 38569539935](https://github.com/FantasticDevHQ/better-stripe/actions/runs/38569539935) passed all 15 repository gates, Shadscan 100 and codegen on that exact commit. The local full run passed 14 gates but hit an unrelated existing React coverage test's 5-second timeout under machine load. Coverage is being retried with fewer workers; the timeout, floors, budgets and policies are unchanged.

The first test additions exceeded two frozen test-file budgets. They were extracted into their own focused module; no budgets were raised. A temporary tunnel URL expired during an intermediate rerun. A new tunnel was verified and the successful focused provider delivery/replay test above was repeated. Neither infrastructure issue is claimed as a package pass.
