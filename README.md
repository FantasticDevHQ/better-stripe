<p align="center">
  <a href="https://fantastic.dev"><img src="assets/fantastic-dev-logo.svg" width="80" height="80" alt="Fantastic.Dev" /></a>
</p>

<h1 align="center">Better Stripe</h1>

<p align="center"><strong>Stripe billing and Connect marketplaces, built for Convex.</strong></p>

<p align="center">A <a href="https://fantastic.dev">Fantastic.Dev</a> Project</p>

<p align="center">
  <a href="https://fantastic.dev"><img src="https://img.shields.io/badge/Fantastic.dev-94C173?style=for-the-badge&amp;logoColor=0c0e13" alt="Visit Fantastic.Dev" /></a>
  <a href="https://github.com/FantasticDevHQ"><img src="https://img.shields.io/badge/GitHub-0c0e13?style=for-the-badge&amp;logo=github&amp;logoColor=white" alt="Fantastic.Dev on GitHub" /></a>
  <a href="https://www.youtube.com/@FantasticDevHQ"><img src="https://img.shields.io/badge/YouTube-FF0033?style=for-the-badge&amp;logo=youtube&amp;logoColor=white" alt="Fantastic.Dev on YouTube" /></a>
  <a href="https://twitter.com/FantasticDevHQ"><img src="https://img.shields.io/badge/Twitter_%2F_X-0c0e13?style=for-the-badge&amp;logo=x&amp;logoColor=white" alt="Fantastic.Dev on Twitter / X" /></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@fantastic.dev/better-stripe"><img src="https://img.shields.io/npm/v/@fantastic.dev/better-stripe?style=flat-square" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@fantastic.dev/better-stripe"><img src="https://img.shields.io/npm/dm/@fantastic.dev/better-stripe?style=flat-square" alt="npm monthly downloads" /></a>
  <a href="https://github.com/FantasticDevHQ/better-stripe/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/FantasticDevHQ/better-stripe/ci.yml?branch=main&amp;style=flat-square&amp;label=checks" alt="Repository checks on main" /></a>
  <a href="https://www.npmjs.com/package/@fantastic.dev/better-stripe"><img src="https://img.shields.io/npm/l/@fantastic.dev/better-stripe?style=flat-square" alt="MIT package license" /></a>
  <a href="https://github.com/FantasticDevHQ/better-stripe/stargazers"><img src="https://img.shields.io/github/stars/FantasticDevHQ/better-stripe?style=flat-square" alt="GitHub stars" /></a>
</p>

<p align="center">
  <a href="#installation">Install</a> · <a href="#quick-start">Quick start</a> · <a href="#have-my-agent-set-this-up">Agent setup</a> · <a href="#documentation">Documentation</a>
</p>

---

A [Convex component](https://docs.convex.dev/components) for Stripe Accounts v2,
billing, and Connect marketplaces. It provides checkout, subscriptions, webhook
syncing, marketplace fees and splits, payouts, refunds, and disputes, with React
hooks and headless UI components.

**Version**: `0.118.0` <!-- x-release-please-version --> (pre-1.0). API may change between minor versions until 1.0.

Connect platforms use the default GA API version. Non-Connect merchants using
customer-only Accounts v2 need preview access and an explicit preview version.
Read the [Accounts v2 setup guide](docs/accounts-v2-preview.md) before integrating.

## Package and application responsibilities

BetterStripe owns reusable payment protocols, financial records, durable execution,
and unstyled React workflows. The example app demonstrates those public APIs with
Convex bindings and styled renderers. Consumers should not need to copy its payment
or UI controllers to use the package.

Your application authenticates callers, authorizes the original account or payment,
selects products and business policy, and decides what a paid purchase unlocks.
One-time purchases use payment checkout; subscriptions use subscription checkout.
Digital downloads, access grants, license keys, shipping, and fulfillment belong to
the consuming application. A successful checkout page alone is not proof of payment.
Use verified payment state and make fulfillment idempotent.

See [the example boundary audit](docs/react-workflows-audit.md#package-and-example-boundary)
for concrete ownership rules and the remaining application adapters.

## Installation

```bash
npm install @fantastic.dev/better-stripe
```

Requires Node.js 20+, Convex `^1.46.0`, and React/React DOM `^18.3.1` or `^19.0.0`.
Stripe SDKs are included as dependencies.

## Quick start

### Have my agent set this up

Copy this into your coding agent in your existing Convex application:

```text
Integrate Better Stripe into this existing Convex app using:
https://github.com/FantasticDevHQ/better-stripe
https://github.com/FantasticDevHQ/better-stripe/blob/main/docs/configuration.md
https://github.com/FantasticDevHQ/better-stripe/blob/main/docs/webhooks.md

Read applicable AGENTS.md/AGENT.md files. Inspect Git status, existing payment
code, package manager, lockfile, Convex version and authentication boundaries.
Preserve user changes, existing architecture and application-owned fulfillment.
Install @fantastic.dev/better-stripe with this app's package manager. Follow the
README's manual setup to mount the component, create the host BetterStripe
client and export its webhook handlers, then register the webhook route.
Check the Accounts v2 setup guide for the intended Connect or customer-only use.

Use existing authorized Stripe sandbox access. Keep keys and signing secrets
out of source, chat and logs. Explain any human account/preview-access steps.
Configure separate V1 snapshot and V2 thin event destinations only with user
authorization. Do not charge, refund, transfer funds or change production.

Run this app's Convex code generation and typecheck. Verify the installed
component and host handlers with the project's documented local/test utilities.
Distinguish wiring/typecheck success from an actual verified sandbox webhook
or payment; report anything not exercised. Report changed files, exact commands,
checks passed and remaining account or webhook configuration.
```

### Manual setup

Set `STRIPE_SECRET_KEY` in your Convex deployment, then wire the component, client,
and webhook route as follows. See [configuration](docs/configuration.md) for all
environment variables and TypeScript setup.

### Step 1: Register the component

```typescript
// convex/convex.config.ts
import betterStripe from "@fantastic.dev/better-stripe/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

// betterStripe requires STRIPE_SECRET_KEY; declare it at the app level and pass
// it to the component by reference.
const app = defineApp({
  env: { STRIPE_SECRET_KEY: v.string() },
});
app.use(betterStripe, {
  env: { STRIPE_SECRET_KEY: app.env.STRIPE_SECRET_KEY },
});

export default app;
```

### Step 2: Create a BetterStripe instance

```typescript
// convex/stripe.ts
import { BetterStripe } from "@fantastic.dev/better-stripe";

import { components } from "./_generated/api";

export const stripe = new BetterStripe(components.betterStripe, {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  triggers: {
    checkoutSession: {
      onCompleted: async (ctx, session) => {
        // App-specific transactional logic (same DB transaction)
      },
    },
  },
});

// Export the webhook handler pair; http.ts passes their refs to registerRoutes.
// `syncWebhook` runs your sync triggers in the same transaction as the component
// upsert; `asyncWebhook` runs your async hooks after commit.
export const { syncWebhook, asyncWebhook } = stripe.webhookHandlers();
```

### Step 3: Register webhook routes

```typescript
// convex/http.ts
import { registerRoutes } from "@fantastic.dev/better-stripe";
import { httpRouter } from "convex/server";

import { components, internal } from "./_generated/api";

const http = httpRouter();

registerRoutes(http, components.betterStripe, {
  webhookPath: "/stripe/webhook",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  webhookSecretV2: process.env.STRIPE_WEBHOOK_SECRET_V2,
  webhooks: internal.stripe,
});

export default http;
```

Passing `webhooks: internal.stripe` runs your sync triggers in the same transaction
as component writes. Async hooks run after commit. See [webhooks and triggers](docs/webhooks.md)
for event destinations, signing secrets, and hook examples.

Create separate V1 snapshot and V2 thin event destinations pointing to
`https://<your-deployment>.convex.site/stripe/webhook`. Store their signing secrets
as `STRIPE_WEBHOOK_SECRET` and `STRIPE_WEBHOOK_SECRET_V2` in your Convex deployment.
Follow [webhook setup](docs/webhooks.md#webhook-setup) to configure both destinations.

## Documentation

The [documentation index](docs/README.md) lists all guides. Start with:

- [Configuration](docs/configuration.md), environment variables and API versions.
- [Client API](docs/client-api.md), server methods and recovery workflows.
- [Renewal attachment](docs/renewal-attachment.md), a single-attempt schedule attachment from a Convex Node action, limited to the documented sandbox profile.
- [Webhooks and triggers](docs/webhooks.md), event setup and transactional callbacks.
- [React API](docs/react-api.md) and [workflow examples](docs/react-workflows.md).
- [Marketplace economics](docs/marketplace.md) and [settlement and payouts](docs/settlement.md).
- [Financial observations](docs/financial-observations.md) and [payout revision migration](docs/payout-revision-migration.md).
- [Migration guide](MIGRATION.md) and [release handoff](docs/release-handoff.md).

The [example app](https://github.com/FantasticDevHQ/better-stripe/blob/main/example/README.md)
demonstrates customer, seller, affiliate, and admin flows, including several checkout
integration styles.

### Metered usage

Use native Stripe billing for pay as you go, included monthly units with overages,
and paid prepaid credits. Developers choose units, precision, rates and policy;
BetterStripe owns durable usage/delivery, allowance and credit accounting,
corrections, original-payment settlement and reusable React workflows. Your app
owns authentication, billable activity and authorization.

Start with [setup for developers and AI agents](docs/metering-setup.md), then the
[copyable three-model recipes](docs/metered-usage.md) and
[runnable example](docs/usage-example.md). Use your existing Stripe sandbox and
Convex credentials. Metronome is optional, never a prerequisite.

See [React views](docs/usage-react.md) and [configuration UI](docs/usage-configuration.md)
for forms, exact usage, allowances, prepaid balances and paginated history.
[The verification matrix](docs/usage-verification.md) records native paid-source
proof, packed consumers and account/clock limits. Existing apps should follow
[opt-in adoption, model transitions and rollback](docs/usage-rollout.md).

## Contributing

Example worktrees with Stripe use a **single-machine sandbox pool of one to five
keys**. Other machines need separate sandbox accounts, keys and pools; leases do
not coordinate across machines. See the
[worktree sandbox setup and limits](docs/stripe-sandbox-worktrees.md#single-machine-use-only).

See the [development guide](docs/development.md) for local setup and code generation,
[testing utilities](docs/testing.md) for fixtures, and the [release guide](docs/releasing.md)
for publishing. Run `pnpm run check:all` before submitting changes.

## License

MIT
