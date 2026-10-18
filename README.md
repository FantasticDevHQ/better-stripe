# better-stripe

A [Convex component](https://docs.convex.dev/components) for Stripe Accounts v2,
billing, and Connect marketplaces. It provides checkout, subscriptions, webhook
syncing, marketplace fees and splits, payouts, refunds, and disputes, with React
hooks and headless UI components.

**Version**: `0.59.0` <!-- x-release-please-version --> (pre-1.0). API may change between minor versions until 1.0.

Connect platforms use the default GA API version. Non-Connect merchants using
customer-only Accounts v2 need preview access and an explicit preview version.
Read the [Accounts v2 setup guide](docs/accounts-v2-preview.md) before integrating.

## Installation

```bash
npm install @fantastic.dev/better-stripe
```

Requires Node.js 20+, Convex `^1.46.0`, and React/React DOM `^18.3.1` or `^19.0.0`.
Stripe SDKs are included as dependencies.

## Quick start

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
- [Webhooks and triggers](docs/webhooks.md), event setup and transactional callbacks.
- [React API](docs/react-api.md) and [workflow examples](docs/react-workflows.md).
- [Marketplace economics](docs/marketplace.md) and [settlement and payouts](docs/settlement.md).
- [Migration guide](MIGRATION.md) and [release handoff](docs/release-handoff.md).

The [example app](https://github.com/FantasticDevHQ/better-stripe/blob/main/example/README.md)
demonstrates customer, seller, affiliate, and admin flows, including several checkout
integration styles.

## Contributing

See the [development guide](docs/development.md) for local setup and code generation,
[testing utilities](docs/testing.md) for fixtures, and the [release guide](docs/releasing.md)
for publishing. Run `pnpm run check:all` before submitting changes.

## License

MIT

## Metered usage

Native Stripe integration supports shared configuration and exact quantity helpers at `@fantastic.dev/better-stripe/usage`. See the [setup guide for developers and AI agents](docs/metering-setup.md) and [contracts and sandbox evidence](docs/metered-usage.md). Operational billing APIs are still under development.

[Managed usage subscriptions](docs/usage-subscriptions.md) supports all three billing models, mixed fixed/metered items and Checkout, with retained renewal and invoice provenance.

See [payment-backed prepaid usage](docs/usage-credits.md) for purchases, atomic reservations, credit history and recovery.

See [included usage and optional limits](./docs/usage-limits.md) for atomic reservation accounting, monthly resets and overage policy.

See [native usage settlement](./docs/usage-settlement.md) for original paid invoices, issuer-service purchases and affiliate policy.

See [metered billing authorization](docs/usage-security.md) for host ownership checks, idempotent work, bounded native proofs and recovery.
