# Set up native Stripe metering

BetterStripe's default metering path uses your existing Stripe sandbox. You do not
need a Metronome account or token. Stripe recommends Metronome for new usage-based
integrations, but Billing Meters APIs remain available. This project is building
native Stripe integration into the existing BetterStripe Convex component.

Current status: shared configuration/quantity helpers and repository sandbox probes
are implemented. Atomic recording and bounded local history are available through the
[usage ledger](usage-ledger.md). [Durable provider delivery](usage-delivery.md) is available. Allowance/credit
accounting and the three example UI flows are still under development. The probes
below verify provider behavior directly; they are not public BetterStripe billing
workflows. See [metered usage contracts and evidence](metered-usage.md).

## Prerequisites

Use Node 20 or later and the repository's pinned pnpm version. Start with an
existing Stripe sandbox and a secret key for that sandbox, plus a Convex development
deployment for the example. Keep the sandbox separate from production resources.
Use the existing [Accounts v2 setup](accounts-v2-preview.md) for your account mode;
Connect GA and customer-only public preview have different enrollment/version
requirements. The probes pin `2026-09-30.endive`, as the package does by default.
They do not prove a non-Connect preview configuration.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm run build
```

If the example is not linked to a development deployment, follow the repository's
example setup first. Run Convex deployment commands from `example/`, and check its
`.env.local` deployment selection before setting credentials. Do not use `--prod`
for these steps. A Stripe sandbox key and a Convex deployment credential are
different credentials; one cannot replace the other.

## Supply the existing Stripe sandbox key

The required variable is `STRIPE_SECRET_KEY`. Use a server-only value, never a
`VITE_`/browser variable. A `sk_test_` key is accepted by the probes; live keys are
rejected before requests. An access failure with a restricted key does not prove
that a billing model is unsupported.

To configure the example deployment, use the Convex dashboard's environment-variable
editor or pipe a secret from your secret manager into the CLI. For example, from
`example/`, replacing the reference with your own 1Password item:

```sh
op read 'op://YourVault/YourStripeSandbox/secret-key' |
  pnpm exec convex env set STRIPE_SECRET_KEY
```

The value travels through stdin instead of shell history or a command argument.
Do not run `convex env get` or `op read` by itself in a recorded session. If the
variable is already configured correctly, leave it in place.

For repository-local probes, create an ignored `.env.metering` file containing a
secret reference, not a copied secret value:

```dotenv
STRIPE_SECRET_KEY=op://YourVault/YourStripeSandbox/secret-key
```

Use one authorized interactive terminal for subsequent `op` commands. On macOS,
1Password CLI authorization is per terminal/account and expires after ten minutes
of inactivity or when the app locks. Do not use keepalives or plaintext caches.
Developers using another secret manager can inject the same process environment
without 1Password.

## Run the read-only access check

From the repository root:

```sh
op run --env-file=.env.metering -- node scripts/metering-feasibility.mjs
```

Expected result: `status: 200` and `accessible: true`. Other verification flags
remain `unverified`, because this command only reads the meter endpoint. It does
not create customers, catalogs, events, invoices or charges. On 401/403, check the
sandbox, key permissions and deployment selection before changing code.

## Run all three native-provider scenarios

```sh
op run --env-file=.env.metering -- node scripts/metering-sandbox.mjs
```

This creates synthetic test resources. The same provider-owned Accounts v2 payer
mapping is used for subscriptions and meter events; it does not create an
independent v1 payer to work around identity mismatches. Each model has its own
meter and subscription. The default prepaid fixture is promotional credit, which
is not proof of a paid purchase.

| Scenario                     | Fixture                                           | Expected aggregate | Expected preview total |
| ---------------------------- | ------------------------------------------------- | ------------------ | ---------------------- |
| Pay-as-you-go                | 15 units at 2 US cents/unit                       | 15                 | 30 cents               |
| Included usage plus overages | First 10 units free, then 2 cents/unit            | 15                 | 10 cents               |
| Prepaid                      | 100-cent credit applied to the same 15-unit usage | 15                 | 0 cents                |

The runner retries the identical event with the same idempotency identity. Bounded
polling allows aggregation to catch up. An accepted event alone is insufficient;
look for `aggregationVerified` and `invoiceIdentityVerified` for every model and
compare preview totals with the table. A zero aggregate or preview while delivery
is delayed is not a successful free-usage result. Do not rerun with new source IDs
to repair delayed aggregation, because that can double bill.

The optional purchase check is explicit:

```sh
op run --env-file=.env.metering -- node scripts/metering-sandbox.mjs --verify-test-payment
```

It creates a sandbox PaymentIntent with Stripe's test card, verifies succeeded
status, payer, currency and received amount, then grants paid credits. Pending or
mismatched payments must not grant credits. It requests a refund during cleanup.
No live payments are authorized by this guide. This is a provider feasibility
probe, not the component's future production credit purchase API.

On this API version PaymentIntent filtering uses `allowed_payment_method_types`.
The older `payment_method_types` parameter is rejected. The runner uses the current
parameter. See the source for the exact pinned request contract.

## Cleanup and evidence

The runner expires its grant, requests a refund for a verified test purchase,
cancels its subscriptions without invoicing/proration, archives its prices and
products, and deactivates its meters. Payer records and provider history remain.
Check every cleanup result. API acceptance does not mean an asynchronous refund
has settled. A failed run can require manual cleanup; do not delete unresolved
financial evidence or touch another application's resources.

Save sanitized result JSON and current test/CI links in PR evidence. Exclude API
keys, client secrets, personal emails and raw provider payloads. Record which model,
account mode, API version and stage actually ran. These tests do not by themselves
prove finalized invoices, seller settlement, affiliate economics, corrections,
shared-meter subscription boundaries or strict real-time prepaid access limits.

Run repository verification before handing off changes:

```sh
pnpm exec vitest run scripts/metering-feasibility.test.mjs scripts/metering-sandbox.test.mjs
pnpm exec vitest run src/client/usage/contracts.test.ts scripts/usage-contracts-packed.test.mjs
pnpm run check:all
```

## Instructions for AI agents

Read this guide, the linked usage contracts and repository `AGENTS.md` first.
Confirm the selected development deployment and the secret source without printing
values. Use the existing sandbox and credentials. Do not create a Metronome account
as a prerequisite or provision an alternative customer identity to hide a mismatch.

Keep source-event IDs stable and distinguish transport acceptance, aggregation,
invoice previews and paid invoices. Configuration validation does not authorize a
payer or enable billing. Hosts authorize tenants and billable activity. Component
mutations and durable workers must own accounting and delivery once implemented.

When a check fails, record its stage and sanitized classification. Fix request or
fixture errors before retrying, keep financial operation identities stable, and
report unverified behavior explicitly. Check the source and current primary docs
when provider parameter names change. Do not weaken repository gates or replace
provider proof with mocked output.

## Optional Metronome evaluation

Metronome is a separate service with its own signup, token and Stripe connection.
Its signup asks for work email, name, company, country and employee range. Those
are Metronome onboarding fields, not native Stripe metering requirements.

If a host independently chooses Metronome, use its sandbox token and connect the
intended Stripe test environment. Verify identity and invoice provenance against
BetterStripe before claiming support. This repository currently has no Metronome
adapter or verified Metronome sandbox setup. Native Stripe users can ignore this
optional path.

Primary references:

- [Stripe usage recording](https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage)
- [Accounts v2 customer interoperability](https://docs.stripe.com/accounts-v2/use-accounts-as-customers)
- [Stripe meter event API](https://docs.stripe.com/api/billing/meter-event/create)
- [Stripe billing credits](https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits)
- [Metronome quickstart](https://docs.metronome.com/guides/get-started/api-quickstart)

Use the [native catalog guide](usage-catalog.md) to provision versioned meters and prices through BetterStripe.

Use the [usage observation guide](usage-observations.md) for bounded local reads, native aggregate refreshes and honest invoice/credit availability.
