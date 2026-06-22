---
"@getdojo/better-stripe": minor
---

Simplify webhook handler registration: replace the 18-export `triggersApi()` with a single `stripe.webhookHandlers()` returning a `{ syncWebhook, asyncWebhook }` pair, wired via `registerRoutes(..., { webhooks: internal.stripe })`.

**Breaking (pre-1.0):** `triggersApi()` is removed. The `triggers` (sync, same-transaction) and `hooks` (async, after-commit) constructor shape is unchanged — only the wiring collapses from 18 named refs to 2. Migrate:

```ts
// before
export const { accountUpserted, /* …16 more… */ afterPayoutCompleted } =
  stripe.triggersApi();
registerRoutes(http, components.betterStripe, {
  ...secrets,
  triggers: internal.stripe,
});

// after
export const { syncWebhook, asyncWebhook } = stripe.webhookHandlers();
registerRoutes(http, components.betterStripe, {
  ...secrets,
  webhooks: internal.stripe,
});
```

Also: `STRIPE_SECRET_KEY` is now declared (required) in the component's `convex.config.ts`, so Convex validates its presence at push time; the installing app wires it via `app.use(..., { env: { STRIPE_SECRET_KEY: app.env.STRIPE_SECRET_KEY } })`.
