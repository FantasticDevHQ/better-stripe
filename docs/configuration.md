# Configuration

### Environment Variables

| Variable                   | Required    | Read by   | Description                                                                                                                                                                                                                                               |
| -------------------------- | ----------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`        | Yes         | Component | Declared in the component's `convex.config.ts` (required) and read by the component (e.g. `getStripeMode`). Also passed explicitly via the `BetterStripe` constructor and `registerRoutes`. The installing app must wire it to the component — see below. |
| `STRIPE_WEBHOOK_SECRET`    | Yes         | App       | Signing secret for the V1 snapshot event destination. Read by `registerRoutes` in the app, not the component.                                                                                                                                             |
| `STRIPE_WEBHOOK_SECRET_V2` | No\*        | App       | Signing secret for the V2 thin event destination (Connect account events). \*Required whenever your V2 destination has its own secret (the usual case); falls back to `STRIPE_WEBHOOK_SECRET` if unset.                                                   |
| `STRIPE_PUBLISHABLE_KEY`   | Yes (React) | Frontend  | A public, frontend-only key. Supply it from the frontend's own env (`VITE_STRIPE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`) and pass it as the `publishableKey` prop to the React components. It is **not** a component env var.            |

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

The component pins the Stripe API version internally (`2026-09-30.endive`) using the installed stripe-node 23 SDK's exact API-version type. Upgrading the pinned version requires a package release and changelog entry. Apps do not need to set `STRIPE_API_VERSION`. See [the migration notes](../MIGRATION.md) for removing Dojo's fulfillment-retry patch and upgrading webhook payload versions separately.

### SDK Management

The component owns the Stripe SDK instance internally via a keyed client cache (keyed by API key). Apps pass `STRIPE_SECRET_KEY`; the component handles versioning and client lifecycle. Apps should not create their own Stripe SDK instances for operations that go through the component.

## TypeScript setup

> **TypeScript 6+:** `compilerOptions.types` now defaults to `[]`, so installed `@types/*` packages are no longer included automatically. If Convex's typecheck reports `Cannot find name 'process'` for your `process.env` reads, add `"types": ["node"]` to `convex/tsconfig.json` and make sure `@types/node` is a devDependency.
