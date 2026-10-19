# Configuration

### Environment Variables

| Variable                   | Required    | Read by   | Description                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | ----------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`        | Yes         | Component | Declared in the component's `convex.config.ts` (required) and read by the component (e.g. `getStripeMode`). Also passed explicitly via the `BetterStripe` constructor and `registerRoutes`. The installing app must wire it to the component — see below.                                                                                                   |
| `STRIPE_WEBHOOK_SECRET`    | Yes         | App       | Signing secret for the V1 snapshot event destination. Read by `registerRoutes` in the app, not the component.                                                                                                                                                                                                                                               |
| `STRIPE_WEBHOOK_SECRET_V2` | No\*        | App       | Signing secret for the V2 thin event destination (Connect account events). \*Required whenever your V2 destination has its own secret (the usual case); falls back to `STRIPE_WEBHOOK_SECRET` if unset.                                                                                                                                                     |
| `STRIPE_PUBLISHABLE_KEY`   | Yes (React) | Frontend  | A public, frontend-only key. Supply it from the frontend's own env (`VITE_STRIPE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`) and pass it as the `publishableKey` prop to the React components. The component also accepts it optionally through `app.use` for `stripe.getPublishableKey`; frontend props still need the public key explicitly. |

### Wiring component env vars

The component declares `STRIPE_SECRET_KEY` as a required environment variable in
its `convex.config.ts`. Convex isolates a component's functions from the
deployment's `process.env`, so setting the var with `convex env set` is **not**
enough on its own — the installing app must provide it to the component via
`app.use`:

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import { v } from "convex/values";
import betterStripe from "@fantastic.dev/better-stripe/convex.config";

const app = defineApp({
  env: { STRIPE_SECRET_KEY: v.string() },
});
// Pass by reference so the component always sees the deployment's current value
// (set via `convex env set STRIPE_SECRET_KEY ...`).
app.use(betterStripe, {
  env: { STRIPE_SECRET_KEY: app.env.STRIPE_SECRET_KEY },
});
export default app;
```

The webhook secrets (`STRIPE_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET_V2`) are read
by the app's `registerRoutes`, not the component, so they only need to be set in
the deployment env — no `app.use` wiring required.

### Stripe API Version

The default API version is `2026-09-30.endive`. The supported customer-only
Accounts v2 opt-in is `STRIPE_CUSTOMER_PREVIEW_API_VERSION`, currently
`2026-09-30.preview`. Other values are rejected. This is a constructor option,
not a `STRIPE_API_VERSION` environment variable. Account eligibility and request
version are separate requirements; read [Accounts v2 setup](accounts-v2-preview.md).

```ts
import {
  BetterStripe,
  STRIPE_CUSTOMER_PREVIEW_API_VERSION,
} from "@fantastic.dev/better-stripe";
import { components } from "./_generated/api";

export const stripe = new BetterStripe(components.betterStripe, {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  // Omit for the default Connect/GA integration.
  stripeApiVersion: STRIPE_CUSTOMER_PREVIEW_API_VERSION,
});
```

Use `stripe.registerRoutes(http, config)` to inherit this client's key/version,
or pass the same `stripeApiVersion` explicitly to standalone `registerRoutes`.
Pin snapshot event destinations to the matching version. Changing package
defaults follows the release process; upgrading a client does not migrate existing
provider destinations. See [migration notes](../MIGRATION.md).

### SDK Management

The package manages Stripe clients for its public operations. The shared client
cache is keyed by API key and supported API version. Durable provider adapters
can create isolated clients with their own retry policy. Pass credentials through
the documented constructor or internal provider-action boundary; do not journal
secrets or duplicate the package's Stripe operations in host code.

## TypeScript setup

> **TypeScript 6+:** `compilerOptions.types` now defaults to `[]`, so installed `@types/*` packages are no longer included automatically. If Convex's typecheck reports `Cannot find name 'process'` for your `process.env` reads, add `"types": ["node"]` to `convex/tsconfig.json` and make sure `@types/node` is a devDependency.
