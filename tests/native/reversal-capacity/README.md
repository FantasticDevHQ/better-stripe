# Isolated native reversal capacity regression

This is a manually invoked financial regression fixture, not a mock database test or an example-app feature. It never contacts Stripe. Use a newly provisioned, dedicated local Convex backend with its default native limits and a dummy Stripe key. Do not point it at an application deployment, another agent's instance, or shared data.

Copy the `convex` files into that disposable host. Its component config must mount BetterStripe as `betterStripe`. Install published `@fantastic.dev/better-stripe@0.50.1`, generate the host API and push the fixture. Set `CONVEX_SELF_HOSTED_URL`, `CONVEX_SELF_HOSTED_ADMIN_KEY` and `BTS_NATIVE_INSTANCE` only in the test process environment. Never commit or print the key. The runner verifies the selected local instance name before mutation.

Use the same unique suffix in every stage:

```sh
node tests/native/reversal-capacity/run.mjs seed capacity_regression
node tests/native/reversal-capacity/run.mjs baseline capacity_regression
```

The baseline must fail the registered claim at the native read limit, then verify all 1,000 original frontiers, currency earnings, risk counters and unchanged transfer diagnostics. Keep that backend, SQLite and records intact. Install the built/packed candidate into the same host, regenerate and push its component. Do not reseed or clear the fixture.

```sh
node tests/native/reversal-capacity/run.mjs activate capacity_regression
node tests/native/reversal-capacity/run.mjs candidate capacity_regression
```

Activation must actually activate or confirm every destination. Candidate validation requires exact original slice membership and amounts, matching replay, complete release, unchanged per-currency earnings and no partial diagnostics. Claim increments risk once; releasing unused capacity increments financial revision only. A separate suffix with `shared` as the last argument tests 1,000 legs sharing four destinations; skip the expected-failure baseline stage for that control.

Also retain byte/physical-ID comparisons of original tables, exact risk-event and journal-counter parity, native function completion telemetry, failed-transaction rollback, concurrent risk/funding controls, historical release cases, lifecycle continuation and migration proofs. This basic runner alone is not complete acceptance. A successful native fixture does not guarantee all possible 1,000-document payloads fit aggregate byte, query or execution limits. No test raises those limits or bypasses financial callbacks.

The runner emits each successful first-claim, replay and release receipt before the final aggregate result. Preserve partial stdout and the failure if a later stage aborts. After verifying a failed release fully rolled back, the isolated synthetic fixture can use `release` with the same suffix for a finite quiet recovery check. This is a test-fixture command, not an application recovery executor or permission to retry provider operations.
