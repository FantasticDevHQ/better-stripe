# Set up native Stripe metered billing

Use your existing Stripe sandbox and a Convex development deployment. BetterStripe
supports all three billing models through native Stripe APIs; no Metronome account,
token or signup is required. Start with the [model recipes](metered-usage.md) and
[example walkthrough](usage-example.md). Existing applications should also read
[opt-in adoption and rollback](usage-rollout.md).

## Prerequisites and account selection

The package supports Node 20 or newer. Use Node 24 for the repository and example
toolchain, as CI does, and the pinned `pnpm@10.32.1`. Use the actual reviewed
package candidate; source acceptance does not by itself prove npm publication.

The default pinned Stripe API is `2026-09-30.endive`. The configured key must own
the original issuer realm and test/live mode. Accounts v2 payer subscriptions use
the provider-owned mapped Customer for meter payloads. The example verified the
platform issuer, issuer-only customer billing and eligible connected recipients.
Billing under connected-account headers is unsupported. A separate non-Connect
customer-only preview account requires its own enrollment/version verification;
see [Accounts v2 setup](accounts-v2-preview.md). Do not work around a mismatch by
creating a second payer or switching realms.

## Run the repository example

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm run build
cd example
pnpm exec convex dev --once
```

If the project is not configured, select the intended existing development
project. Confirm its deployment selection in `example/.env.local`; inspect only
`CONVEX_DEPLOYMENT` and the public `VITE_CONVEX_URL`, not an entire secret file.
Keep every Convex command below in `example/`. These commands do not use `--prod`.
Before invoking them, remove ambient `CONVEX_DEPLOY_KEY`,
`CONVEX_DEPLOYMENT_TOKEN`, `CONVEX_SELF_HOSTED_URL` and
`CONVEX_SELF_HOSTED_ADMIN_KEY` overrides from this terminal. Confirm that
`example/.env.local` and `example/.env` do not define those overrides and that
any ambient `CONVEX_DEPLOYMENT` matches the selected `dev:` deployment.
Deployment keys can override the selection even when you omit `--prod`.
If initial deployment stops for a missing required environment value, configure
that value on the selected development deployment, then repeat the deploy.

The required server variable is `STRIPE_SECRET_KEY`. If the existing deployment
already has the correct sandbox key, reuse it. Otherwise use its Convex dashboard
environment editor, or pipe from a secret manager. For 1Password, replace this
reference with your own item. Create an ignored, untracked `../.env.stripe-sandbox`
containing only `STRIPE_SECRET_KEY=op://YourVault/YourStripeSandbox/secret-key`.
It stores a reference, never a copied secret. Run in one authorized interactive terminal:

```sh
op run --env-file=../.env.stripe-sandbox -- node --input-type=module -e '
import { spawnSync } from "node:child_process";
const key = process.env.STRIPE_SECRET_KEY;
if (!/^sk_test_[A-Za-z0-9]+$/.test(key ?? "")) {
  console.error("A nonempty Stripe sandbox secret is required"); process.exit(1);
}
const result = spawnSync("pnpm", ["exec", "convex", "env", "set", "STRIPE_SECRET_KEY"], {
  input: key, stdio: ["pipe", "ignore", "ignore"],
});
if (result.status !== 0) {
  console.error("Sandbox environment update failed"); process.exit(1);
}
'
pnpm exec convex dev --once
pnpm dev
```

The omitted CLI value reads stdin, keeping the secret out of command arguments
and shell history. Do not run `convex env get`, print all environment values, or
paste secrets into screenshots, source or browser storage. Never prefix the
secret with `VITE_`. Other example payment screens can use a public publishable
key; that key cannot replace the server key. 1Password CLI authorization on macOS
is per terminal/account and expires after ten idle minutes or app lock. Reuse
one terminal; do not use keepalives or plaintext caches. Other secret managers
can supply the same stdin/process environment without 1Password.

Use the local URL printed by Vite, then `/demo/metered-usage`. If this is a new,
empty development example, use `/admin/setup` to seed the required demo personas.
Existing seeded deployments need no reset or re-seed. Do not run destructive setup
or mutate another application's database to make this flow work.

The persona switcher is test-only, not production authentication. In an application,
authenticate callers and resolve/authorize original payer, product, price, activity
and recipient policy on the server. See [usage security](usage-security.md).

## Verify the product flows

Set the server-owned checkout return origin to your Vite URL. This value is not a
secret. For a default Vite server:

```sh
pnpm exec convex env set FRONTEND_URL http://localhost:5173
```

Use `http://localhost:4319` instead when Vite is running on port 4319. Set this
before creating an enrollment. The example retains the original return origin
with that enrollment, so changing the environment does not rewrite an existing
Checkout intent.

Choose Seller → Maya's Fitness Studio → Metered billing. Attach Included monthly
usage to the coaching membership product. The default terms are USD 20 monthly,
60 included coaching minutes and USD 1 per extra minute. Compare the via API and
BetterStripe components tabs before and after attachment.

Choose Customer, review the membership, complete its original test Checkout,
refresh enrollment, and record coaching minutes. Admin → Metered billing controls
store enablement separately. Sasha's Ceramics starts disabled. For pay as you go,
create another coaching product with a zero monthly base price. For prepaid,
configure the admin's own Store analytics reports product and verify that work is
held before a paid grant and denied after credit exhaustion.

Follow [the product walkthrough](usage-example.md) for exact steps, authorization,
payment verification, retained history and automatic mixed-invoice seller
settlement. Choose the seller's store plan before accepting new customer payments. Product subscriptions use actual native billing periods and the
customer's original account; this flow does not advance shared test clocks.

For isolated clock-driven renewal, correction and cleanup checks, use Admin →
Developer protocol diagnostics and follow the separate
[protocol diagnostics guide](usage-protocol-diagnostics.md). Those runs retain
their dedicated original resources and financial evidence. Never use diagnostic
cleanup to archive a seller's shared product or a real customer's account.

## Install in your own Convex application

Install the reviewed published package, or your actual reviewed tarball, plus
`convex`. For a published release:

```sh
pnpm add @fantastic.dev/better-stripe convex
```

Candidate reviewers should install the produced `.tgz` instead of assuming a
source commit has been published. Keep the original component instance name
when upgrading:

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import { v } from "convex/values";
import betterStripe from "@fantastic.dev/better-stripe/convex.config";
const app = defineApp({ env: { STRIPE_SECRET_KEY: v.string() } });
app.use(betterStripe, {
  env: { STRIPE_SECRET_KEY: app.env.STRIPE_SECRET_KEY },
});
export default app;
```

Generate bindings through the supported Convex CLI in your chosen development
application. Configure the SDK key as well as the component environment:

```ts
// convex/stripe.ts
import { BetterStripe } from "@fantastic.dev/better-stripe";
import { components } from "./_generated/api";

export const stripe = new BetterStripe(components.betterStripe, {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
});
```

The catalog's meter/price provisioning uses this server SDK key. Keep it in the
same original sandbox realm as the component's key. Do not hand edit generated APIs. The component installs its nested
Workflow/Workpool runtime; do not add a second sibling worker. Start with one
original managed binding and the [per-model recipes](metered-usage.md), then wire
[internal delivery/callbacks](usage-delivery.md), [scoped observations](usage-observations.md)
and [React views](usage-react.md). Configuration-only validation does not authorize
usage or enable a paid credit grant.

## Troubleshooting and AI-agent runbook

| Symptom                            | Next action                                                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 401/403 or `provider_unavailable`  | Verify the selected development project, sandbox/key permissions and pinned API access. Do not print the key or assume the model is unsupported.                               |
| Realm or mapped-customer mismatch  | Resolve original native issuer/payer/Customer provenance. Keep original IDs; do not provision an alternative payer.                                                            |
| Accepted event, stale/zero summary | Keep transport acceptance separate from aggregation. Refresh complete original period evidence; missing or lagging data is not free usage.                                     |
| Unknown provider outcome           | Retain the original source/operation IDs and inspect scoped delivery/history. Resume only a supported verified recovery path; never blind resend or move work to a new scope.  |
| Prepaid balance held               | Reconcile original payment, grant, native transactions and invoice applications; resolve refunds/disputes or pending finalization. Never grant locally because a UI says paid. |
| Paid invoice but no transfer       | Inspect original cash, actual processing fee and recipient eligibility. A paid invoice does not establish settlement.                                                          |
| Cleanup refuses reset              | Resolve retained usage, reservations, purchase/correction intents and original financial liabilities. Do not delete rows, clocks or payer evidence.                            |

AI agents should read repository `AGENTS.md`, this guide, the model recipes and
verification limits first. Confirm only non-secret development selection and the
secret source. Use existing sandbox credentials, stable business IDs and normal
codegen. Reuse the server's authorization boundary and package controllers rather
than building another ledger in the example. Report the exact failed stage and
sanitized classification. Preserve unknown outcomes and original timestamps.

From the repository root, run the checks and evidence auditor listed in
[verification](usage-verification.md), including `pnpm run check:all`. Retain
sanitized proof and current CI links directly in the PR. The release handoff does
not authorize publication, production migration or live billing.

Repository-only feasibility probes remain available as
`scripts/metering-feasibility.mjs` and `scripts/metering-sandbox.mjs`. Inject a test
key with a secret manager, for example `op run --env-file=.env.metering -- node
scripts/metering-feasibility.mjs`, where the ignored file contains an `op://`
reference rather than a copied secret. The default sandbox probe's promotional
credit is not paid-prepaid proof; its explicit `--verify-test-payment` probe has
separate refund/cleanup results. Prefer the actual package example and retained
paid-source evidence for integration acceptance.

Primary provider contracts: [meter event identity/windows](https://docs.stripe.com/api/billing/meter-event/create),
[Accounts v2 customer mapping](https://docs.stripe.com/accounts-v2/use-accounts-as-customers),
and [native billing credits](https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits).
