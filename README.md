# Customer-only Accounts v2 preview candidate evidence

Implementation commit: `aefaca1` on `codex/accounts-v2-customer-preview`, based on the official 0.10.0 release.

- All 15 repository gates passed with `VITEST_MAX_WORKERS=4 pnpm run check:all` in 60.7s. No floors, budgets, timeout or policy changes.
- 47 focused tests passed. They exercise actual stripe-node serialization against a mocked HTTP transport, proving selected version headers and stable caller idempotency keys across account/Checkout, reads, billing portal, cancellation/reactivation and refunds. Account creation applies only customer configuration.
- Webhook tests verify inherited client key/version, conflict rejection, customer-only thin-event includes and metadata sync, pinned snapshot versions, unversioned thin payloads, canonical preview scopes and refusal to reuse incompatible destinations. GA behavior has regression coverage.
- A fresh temporary consumer installed the npm-pack candidate with scripts disabled. Runtime imports/route setup and consumer TypeScript compilation passed. `candidate-contracts.json` is the runtime result. TypeScript validated the new constant, supported-version type, constructor property and instance route, and rejected an unsupported version.
- The existing example development backend deployed successfully; it remains configured for GA. No Stripe preview setting, Connect onboarding or payout policy was changed.

## Unverified live acceptance

No live non-Connect checkout, receipt, subscription sync, portal or refund flow is claimed passed. That acceptance requires an owner-enabled non-Connect sandbox and authorized credential access, which are pending. Mocked transport, the GA Connect example and TypeScript checks do not prove merchant preview eligibility.

The package code is not yet released on npm. The enclosed tarball is an **unpublished QA candidate**; its manifest still carries the base 0.10.0 version. It is not the registry 0.10.0 artifact and must not be represented as an official published fix. Install it only into an isolated QA project.

Candidate SHA-256: `ade75ea58a54fcf821d95ebbb708edfb0833c661b431fe4e071dbf0b85909e6c`.

Official requirements: https://docs.stripe.com/accounts-v2/use-accounts-as-customers
Snapshot version/scope restrictions: https://docs.stripe.com/api/v2/core/event-destinations/create and https://docs.stripe.com/api/v2/core/event-destinations/update
