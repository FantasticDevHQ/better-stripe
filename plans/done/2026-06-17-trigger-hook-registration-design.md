# Design sketch — simplifying trigger/hook registration

Status: **implemented** (Option A shipped 2026-06-22 — see
`done/2026-06-21-simplify-webhook-handler-registration.md`)
Date: 2026-06-17

## Decisions (2026-06-21)

- **Definition shape: Option A.** Keep the current `triggers` (domain-nested sync)
  and `hooks` (flat async) on the `BetterStripe` constructor. Replace the
  18-export `triggersApi()` with a single `stripe.webhookHandlers()` returning a
  `{ syncWebhook, asyncWebhook }` pair, wired via `registerRoutes(..., { webhooks: internal.stripe })`.
- **Migration: clean cutover.** Remove `triggersApi()` entirely (breaking,
  acceptable pre-1.0). Migrate the example app and dojo in the same change.

## Goal

Keep the sync-trigger + async-hook model (the dojo investigation confirmed both
tiers are needed — entitlement grants/revocations require same-transaction sync
triggers; email/Slack-style effects fit async hooks). Make registration **much
easier to understand and wire up**, with minimal boilerplate.

## Why this model (recap)

- **Sync triggers** run in the *same transaction* as the component's billing
  write. Throwing rolls back both. Required for atomic entitlement changes.
- **Async hooks** are scheduled *after* commit (action context, I/O allowed).
  Eventual; for email/Slack/analytics. This is the "emit and react later" tier.
- A component cannot call/schedule the installing app's functions, so the
  webhook handler must stay app-side to dispatch app reactions. Consequence:
  the webhook secret is read app-side (already settled — not declared in the
  component).

## Current API (from source)

Definition is reasonable and typed:

```ts
// convex/stripe.ts
export const stripe = new BetterStripe(components.betterStripe, {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  triggers: {                                  // SYNC (same txn)
    subscription: { onUpdate: (ctx, sub, prev) => {...}, onDelete: (ctx, sub) => {...} },
    checkoutSession: { onCompleted: (ctx, session) => {...} },
  },
  hooks: {                                     // ASYNC (after commit)
    onCheckoutCompleted: (ctx, session) => {...},
  },
});
```

The friction is the wiring, not the definition:

```ts
// 18 dispatcher/hook refs must be exported...
export const {
  accountUpserted, productUpserted, priceUpserted, subscriptionUpserted,
  subscriptionDeleted, checkoutSessionUpserted, invoiceUpserted, paymentUpserted,
  payoutUpserted, afterAccountUpdated, afterCheckoutCompleted, afterSubscriptionUpdated,
  afterSubscriptionCanceled, afterTrialEnding, afterInvoicePaid, afterPaymentSucceeded,
  afterPaymentFailed, afterPayoutCompleted,
} = stripe.triggersApi();

// ...and threaded into the webhook registration
registerRoutes(http, components.betterStripe, { ..., triggers: internal.stripe });
```

dojo reacts to ~3 events but must surface all 18 dispatchers.

## Why some exports are unavoidable

Convex can only invoke a function by a **statically-exported reference**, and we
need two contexts: an `internalMutation` so the sync handler runs *in the
component-write transaction*, and an `internalAction` so the async handler can be
*scheduled* and do I/O. So the floor is **2 exports**, not 0. The win is 18 → 2.

## Option A — keep definition shape, kill the 18-export

```ts
// convex/stripe.ts
export const stripe = new BetterStripe(components.betterStripe, {
  triggers: { subscription: { onUpdate, onDelete }, checkoutSession: { onCompleted } },
  hooks:    { onCheckoutCompleted },
});

// ONE pair of generated functions instead of 18 named refs:
export const { syncWebhook, asyncWebhook } = stripe.webhookHandlers();

// convex/http.ts
registerRoutes(http, components.betterStripe, {
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  webhookSecret:   process.env.STRIPE_WEBHOOK_SECRET,
  webhookSecretV2: process.env.STRIPE_WEBHOOK_SECRET_V2,
  webhooks: internal.stripe,        // points at the two generated fns
});
```

Smallest change; preserves the familiar `triggers`/`hooks` shape.

## Option B — consolidate into one `events({ on, after })` block

```ts
// convex/stripe.ts
export const stripe = new BetterStripe(components.betterStripe);

export const { onStripeEvent, afterStripeEvent } = stripe.events({
  on: {                                    // SYNC — same txn (mutation ctx, no I/O)
    checkoutCompleted:   (ctx, session)      => grantAccess(ctx, session),
    subscriptionUpdated: (ctx, sub, prevSub) => syncMembership(ctx, sub),
    subscriptionDeleted: (ctx, sub)          => revokeMembership(ctx, sub),
  },
  after: {                                 // ASYNC — after commit (action ctx, I/O ok)
    checkoutCompleted: (ctx, session) => sendWelcomeEmail(ctx, session),
  },
});

// convex/http.ts
registerRoutes(http, components.betterStripe, { ...secrets, events: internal.stripe });
```

One source of truth; `on` vs `after` makes the sync/async distinction explicit
in the shape of the API. Bigger reshape than A.

Both options: list only the events you care about; the component still syncs its
own DB for every event regardless. Handlers keep typed payloads; `on`/sync gets a
mutation-style ctx, `after`/async gets an action-style ctx.

## Open questions

1. **Definition shape:** Option A (keep `triggers`/`hooks`) vs Option B (`events({on, after})`).
2. **Migration:** clean cutover (remove `triggersApi()`, breaking — acceptable pre-1.0)
   vs keep `triggersApi()` working alongside the new API during a deprecation window.
3. **dojo reconciliation:** confirm dojo's exact current usage and provide the
   migration diff as part of the change.

## Mechanism (either option)

`stripe.webhookHandlers()` / `stripe.events()` returns one `internalMutation`
(sync) + one `internalAction` (async). The webhook http action verifies the
signature, calls the sync mutation (which does the component upsert **and** the
sync handler in one transaction), then schedules the async action. Same
atomicity guarantees as today, far less boilerplate.
