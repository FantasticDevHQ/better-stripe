# better-stripe

A reusable [Convex component](https://docs.convex.dev/components) for the Stripe V2 Accounts API — a **Stripe V2 marketplace/Connect library**, not just a webhook wrapper. Provides a complete billing + marketplace-economics backend: schema, queries, mutations, actions, webhook handling, platform fees, multi-recipient splits, rolling payouts, dispute clawback, per-store statement descriptors, React hooks, and headless UI components.

Built for Convex + Next.js applications. Follows the conventions established by [`@convex-dev/stripe`](https://github.com/get-convex/stripe) and [`@convex-dev/better-auth`](https://github.com/get-convex/better-auth).

## Status

**Version**: `0.4.0` <!-- x-release-please-version --> (pre-1.0). API may change between minor versions until 1.0.

Used in production by its authors. Webhook pipeline is covered by unit tests and a live E2E harness (`npm run e2e:webhooks`) that fires real Stripe-signed events and asserts the ledger.

### Releasing

Releases are automated with [Release Please](https://github.com/googleapis/release-please-action) and published to npmjs.com as `@fantastic.dev/better-stripe`. **Don't bump the version or edit `CHANGELOG.md` by hand.**

1. **Give every PR a Conventional Commit title** (it becomes the squash-merge commit):
   - `fix: …` makes a patch release.
   - `feat: …` makes a minor release.
   - `feat!: …` (or a `BREAKING CHANGE:` footer) makes a minor release while the package is pre-1.0.
   - `docs:`, `chore:`, `ci:`, `refactor:`, `test:`, `build:` and `perf:` appear in the changelog too. On their own they still open a patch release PR, which you can leave open to collect more changes: nothing publishes until that PR is merged.

   Write the title for consumers of the package: it becomes the changelog entry. A title that isn't a Conventional Commit is left out.
2. **On merge to `main`**, the `Release` workflow opens or updates a release PR that bumps `package.json`, `CHANGELOG.md`, the version line above and `.release-please-manifest.json`.
3. **Merging the release PR** is the release decision. The same run tags the version, creates the GitHub release and publishes to npm through [trusted publishing](https://docs.npmjs.com/trusted-publishers) with provenance. There's no npm token.

Release policy lives in `release-please-config.json`. Keep the workflow file named `release.yml`, because the trusted publisher on npmjs.com is bound to that filename. A manually pushed `vX.Y.Z` tag also publishes, but only if it matches `package.json` and `CHANGELOG.md` has a section for it (`scripts/release-notes.mjs`). If publishing fails after the GitHub release is created, use **Re-run failed jobs** on that run. Check npm first if the outcome is uncertain: a published version can't be overwritten.

The private `example` workspace isn't published.

### Regenerating codegen

The component ships committed Convex codegen output at `src/component/_generated/{api,component,dataModel,server}.ts` — consumers reach the bindings via the `./_generated/component` subpath export. The example app also commits its own codegen at `example/convex/_generated/`. Running `pnpm dev` (which wraps `convex dev`) regenerates these automatically when the schema or function definitions change, but only against the live dev deployment and only while the dev server is watching.

If you add, remove, or rename a query/mutation/action on a branch without the dev server watching — or after a rebase — regenerate explicitly before committing:

```bash
pnpm codegen            # regen the library component + example app
pnpm codegen:lib        # regen src/component/_generated only
pnpm codegen:example    # regen example/convex/_generated only
```

All three require a configured dev deployment (`CONVEX_DEPLOYMENT` env var, normally set by a prior `npx convex dev`). They write only the local `_generated/` files — they don't push code or data to the deployment.

**CI gate (BTS-104 / BTS-111 / BTS-112).** Two layers verify the committed files are not stale:

1. **Structural drift check** (`pnpm codegen:check`, always runs in CI): two independent scans, each checking both directions (every source export appears in the generated file, and every generated entry still has a matching source), neither needing a deployment:
   - Library component — scans `src/component/**/*.{queries,mutations,actions}.ts` and verifies every exported function appears in `src/component/_generated/component.ts`. This is the [BTS-31](https://linear.app/dojoco/issue/BTS-31)/[BTS-50](https://linear.app/dojoco/issue/BTS-50) and [BTS-74](https://linear.app/dojoco/issue/BTS-74) incident class. The reverse direction also flags a stale entry left behind by a *deleted* query/mutation/action (BTS-112). The export-detection regex intentionally matches only direct `query(...)`/`mutation(...)`/`action(...)` exports — not wrapper or re-export forms like `customQuery(...)` (convex-helpers) or `export { fn as name }`, which this component has none of today; widen the regex (and the reverse scan) rather than assuming that stays true.
   - Example app — scans `example/convex/**/*.ts` and verifies every source module is imported and registered in `example/convex/_generated/api.ts`. Catches the common case of adding a new `example/convex/<module>.ts` (or nested file like `example/convex/lib/<module>.ts`) without regenerating (BTS-111). The reverse direction likewise flags a stale import left behind by a *deleted* module (BTS-112).
2. **Authoritative regen-and-diff** (runs in CI when `CONVEX_DEPLOYMENT` is configured): runs `pnpm codegen` against the configured dev deployment and fails if `git diff` shows changes. Catches every drift case, including validator-shape changes the structural check can't see. To enable on a fork, set the `CONVEX_DEPLOYMENT` repo secret to a dev deployment name and authorize the CI runner — see Convex's [GitHub Actions guide](https://docs.convex.dev/production/integration/deployments#github-actions).

### Relation to `@convex-dev/stripe`

This component targets the Stripe **V2 Accounts API** (Connect/marketplace-first) with a transactional trigger system. [`@convex-dev/stripe`](https://github.com/get-convex/stripe) targets the classic Customers/V1 API. They are different data models — there is no automated migration. Choose by which Stripe API generation your app uses.

## Features

- **V2 Accounts API** -- Account creation, onboarding, Connect/marketplace, merchant and recipient configurations
- **Products and Prices** -- Full CRUD with trial day management as a first-class feature
- **Checkout** -- Both embedded (custom UI mode) and redirect checkout session creation
- **Subscriptions** -- Lifecycle management including cancel, reactivate, quantity updates, and trial tracking
- **Marketplace fees** -- Platform fee config (percent, fixed, tiered), resolved per-call or as a global default, applied via `application_fee_percent`/`application_fee_amount` or computed per invoice/charge
- **Split engine** -- Single-recipient destination charges or multi-recipient separate-charges-and-transfers (store + affiliate(s)), computed and executed by the webhook engine
- **Invoices** -- Invoice syncing and querying with metadata propagation from subscriptions
- **Payments** -- Payment intent tracking and status management
- **Payouts** -- Automatic rolling payouts for Connect/marketplace flows, with a recipient balance + cadence React surface
- **Refunds** -- Refund tracking with refunded-amount/status denormalized onto the linked payment, plus proportional platform-fee return and transfer reversal (destination charges via Stripe flags, split sales via webhook-driven ledger math)
- **Disputes** -- Chargeback/dispute tracking with evidence submission and close helpers, plus automatic transfer clawback on open, reinstatement on a won dispute, and auto-cancel of the disputed subscription
- **Per-store statement descriptors** -- Buyer-recognizable charge descriptors resolved per seller with a configurable platform fallback
- **Webhook handling** -- Single-endpoint processing with ledger-based deduplication and replay protection
- **Trigger system** -- BetterAuth-style sync triggers (same transaction) and async hooks (scheduled action) for app-layer extensibility
- **React hooks** -- Read hooks and flow hooks for all billing and marketplace-economics domains (fees, splits, earnings, payouts, disputes)
- **Headless UI components** -- Checkout, subscription, payment method, Connect, payout, split, and dispute components with render-prop customization
- **Test utilities** -- Typed fixture factories, mock webhook events, and `assertTestEnvironment` guard

See [Roadmap / Known Gaps](#roadmap--known-gaps) for what's still in flight.

## Roadmap / Known Gaps

The marketplace economics layer described above — platform fees, the split engine, rolling payouts, dispute clawback/reinstate, refund fee/transfer reversal, and per-store statement descriptors — is **implemented and merged**, tracked as issues on the `BTS` team in Linear. This section lists what's honestly still open, by ticket, rather than letting the feature list overstate the current state:

- **[BTS-67](https://linear.app/dojoco/issue/BTS-67)** — the first charge of every destination-charge subscription carries no per-store statement descriptor. Direct `charge_automatically` subscriptions (and Checkout subscription mode) finalize and pay their first invoice synchronously at creation, before the `invoice.created` handler that sets the descriptor can run. Later invoices are unaffected. A product-level `statement_descriptor` fix (which would cover the first charge too) is proposed but not built.
- **[BTS-68](https://linear.app/dojoco/issue/BTS-68)** — investigating whether the fixed/tiered per-invoice platform fee has the same first-invoice gap as BTS-67 (same `invoice.created` timing), which would be a fee-revenue miss rather than a cosmetic one. Not yet confirmed or fixed.
- **[BTS-63](https://linear.app/dojoco/issue/BTS-63)** — dispute clawback (`reverseTransfers`) retrying after a partial success can hit Stripe idempotency-key conflicts on the legs that already succeeded.
- **[BTS-64](https://linear.app/dojoco/issue/BTS-64)** — the earnings/split ledger queries backing `useEarnings` and `useSplitBreakdown` (`listTransfersByAccount`, `listTransfersByCharge`) silently cap at 50 rows, which can understate gross/net totals for high-volume accounts or heavily-split sales.

## Installation

```bash
npm install @fantastic.dev/better-stripe
```

The package bundles `stripe`, `@stripe/stripe-js`, and `@stripe/react-stripe-js` as dependencies. You do not need to install Stripe packages separately.

Peer dependencies: `convex >= 1.29.3`, `react >= 18.3.1`, `react-dom >= 18.3.1`.

## Quick Start

The consumer contract has three steps:

### Step 1: Register the component

```typescript
// convex/convex.config.ts
import betterStripe from "@fantastic.dev/better-stripe/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

// betterStripe requires STRIPE_SECRET_KEY; declare it at the app level and pass
// it to the component by reference (see "Wiring component env vars" below).
const app = defineApp({
  env: { STRIPE_SECRET_KEY: v.string() },
});
app.use(betterStripe, {
  env: { STRIPE_SECRET_KEY: app.env.STRIPE_SECRET_KEY },
});

export default app;
```

### Step 2: Create a BetterStripe instance with triggers

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
    subscription: {
      onUpdate: async (ctx, newSub, oldSub) => {
        // Update app-owned tables within the same transaction
      },
    },
  },
  hooks: {
    onCheckoutCompleted: async (ctx, session) => {
      // Async side effects: email, Slack, analytics
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

The `webhooks: internal.stripe` line passes the function references of the `syncWebhook`/`asyncWebhook` pair you exported in step 2 (here from `convex/stripe.ts`). Don't confuse this with the callback `triggers`/`hooks` on the `BetterStripe` constructor in step 2, which take your raw handlers. When `webhooks` is provided, webhook upserts run through `syncWebhook` so your sync triggers execute in the same transaction as the component write, and your async hooks are scheduled (via `asyncWebhook`) after commit. If omitted, the handler falls back to direct component upserts and no triggers fire.

> **Why two webhook secrets?** Stripe requires separate event destinations for V1 snapshot events (payments, subscriptions) and V2 thin events (Connect account lifecycle). Each destination has its own signing secret. The handler uses `webhookSecret` for V1 events and `webhookSecretV2` for V2 events. See [Webhook Setup](#webhook-setup) for details.

## Client API Reference

All methods are available on the `BetterStripe` class instance. Methods that call the Stripe API are actions; methods that only read Convex data are queries.

Methods named `get<Entity>` take the component document ID (exception: `getInvoice`, which takes the Stripe invoice ID); methods named `get<Entity>ByStripeId` take the Stripe ID (`acct_...`, `prod_...`, `price_...`, `cs_...`, `sub_...`).

### Account

| Method                                                                            | Description                                              |
| --------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `createAccount(ctx, { userId, email?, name?, country?, orgId?, metadata? })`      | Create a V2 account in Stripe and the component database |
| `getAccount(ctx, { accountId })`                                                  | Get account by component document ID                     |
| `getAccountByStripeId(ctx, { stripeAccountId })`                                  | Get account by Stripe account ID                         |
| `getOrCreateAccount(ctx, { userId, email?, name?, country?, orgId?, metadata? })` | Get existing or create new account                       |
| `getAccountByUserId(ctx, { userId })`                                             | Get account by app-layer user ID                         |
| `getAccountByOrgId(ctx, { orgId })`                                               | Get account by organization/team ID                      |
| `getAccountOnboardingStatus(ctx, { accountId })`                                  | Get Connect onboarding status (by component document ID) |
| `updateAccount(ctx, { stripeAccountId, email?, name?, metadata? })`               | Update account fields                                    |
| `createAccountLink(ctx, { stripeAccountId, refreshUrl, returnUrl, type })`        | Create Connect onboarding or update link                 |
| `createAccountSession(ctx, { stripeAccountId, components })`                      | Create embedded account management session               |
| `createLoginLink(ctx, { stripeAccountId })`                                       | Create Express dashboard login link                      |
| `addRecipientConfiguration(ctx, { stripeAccountId })`                             | Add recipient configuration to an existing account       |
| `getV2Account(ctx, { stripeAccountId, include? })`                                | Retrieve a V2 account directly from Stripe               |
| `updateV2Account(ctx, { stripeAccountId, updateParams })`                         | Update a V2 account in Stripe                            |
| `listStripeAccounts(ctx, { limit? })`                                             | List V2 accounts directly from Stripe                    |
| `closeAccount(ctx, { stripeAccountId })`                                          | Close a V2 account; returns `{ closed: boolean }`        |
| `restartAccountOnboarding(ctx, { stripeAccountId })`                              | Close the account so onboarding can restart fresh        |
| `setAccountStatementDescriptor(ctx, { stripeAccountId, statementDescriptor })` | Set (or `null` to clear) the account's per-store statement-descriptor suffix |
| `createDisputeSession(ctx, { stripeAccountId })` | Create an embedded Account Session scoped to the seller's disputes |

### Product and Price

| Method                                                                                                                | Description                                   |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `createProduct(ctx, { name, description?, active?, accountId?, metadata? })`                                          | Create product in Stripe and component DB     |
| `getProduct(ctx, { productId })`                                                                                      | Get product by component document ID          |
| `getProductByStripeId(ctx, { stripeProductId })`                                                                      | Get product by Stripe product ID              |
| `listProducts(ctx, { accountId?, active?, limit? })`                                                                  | List products with optional filters           |
| `updateProduct(ctx, { stripeProductId, ...updates })`                                                                 | Update product fields                         |
| `deactivateProduct(ctx, { stripeProductId })`                                                                         | Deactivate product in Stripe and component DB |
| `createPrice(ctx, { stripeProductId, unitAmount, type, currency?, interval?, intervalCount?, nickname?, metadata? })` | Create price in Stripe and component DB       |
| `getPrice(ctx, { priceId })`                                                                                          | Get price by component document ID            |
| `getPriceByStripeId(ctx, { stripePriceId })`                                                                          | Get price by Stripe price ID                  |
| `listPrices(ctx, { productId?, active?, limit? })`                                                                    | List prices with optional filters             |
| `updatePrice(ctx, { stripePriceId, ...updates })`                                                                     | Update price fields                           |
| `deactivatePrice(ctx, { stripePriceId })`                                                                             | Deactivate price in Stripe and component DB   |

### Checkout and Subscription

| Method                                                                                                                                                                     | Description                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `createCheckoutSession(ctx, { userId, stripePriceId, mode, returnUrl, uiMode?, quantity?, trialDays?, accountId?, orgId?, customerEmail?, destinationAccountId?, split?, fee?, amount?, metadata?, sessionOverrides? })` | Create checkout session (embedded or redirect); `destinationAccountId`/`split` route funds, `fee` overrides the platform's configured default |
| `getCheckoutSession(ctx, { sessionId })`                                                                                                                                   | Get checkout session by component document ID                                                                     |
| `getCheckoutSessionByStripeId(ctx, { stripeSessionId })`                                                                                                                   | Get checkout session by Stripe session ID                                                                         |
| `createSubscription(ctx, { userId, orgId?, customerAccount, stripePriceId, destinationAccountId?, split?, fee?, trialDays?, metadata? })` | Create a subscription directly for a V2 buyer (off the checkout flow), with the same routing/fee options as checkout |
| `getSubscription(ctx, { subscriptionId })`                                                                                                                                 | Get subscription by component document ID                                                                         |
| `getSubscriptionByStripeId(ctx, { stripeSubscriptionId })`                                                                                                                 | Get subscription by Stripe subscription ID                                                                        |
| `listSubscriptions(ctx, { stripeAccountId?, status?, limit? })`                                                                                                            | List subscriptions, optionally scoped to a Connect account (use `listSubscriptionsByUser` for per-user filtering) |
| `listSubscriptionsByUser(ctx, { userId, status? })`                                                                                                                        | List all subscriptions for a user                                                                                 |
| `listSubscriptionsByOrg(ctx, { orgId, status? })`                                                                                                                          | List all subscriptions for an organization                                                                        |
| `getActiveSubscription(ctx, { userId, orgId? })`                                                                                                                           | Get the active subscription for a user or org                                                                     |
| `getTrialStatus(ctx, { subscriptionId })`                                                                                                                                  | Get trial state for a subscription                                                                                |
| `cancelSubscription(ctx, { stripeSubscriptionId, cancelAtPeriodEnd? })`                                                                                                    | Cancel subscription immediately or at period end                                                                  |
| `reactivateSubscription(ctx, { stripeSubscriptionId })`                                                                                                                    | Reactivate a canceled subscription                                                                                |
| `updateSubscriptionQuantity(ctx, { stripeSubscriptionId, quantity })`                                                                                                      | Update subscription seat quantity                                                                                 |

### Invoice, Payment Method, and Payout

| Method                                                                               | Description                                                                                |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `getInvoice(ctx, { stripeInvoiceId })`                                               | Get invoice by Stripe invoice ID                                                           |
| `getInvoiceByStripeId(ctx, { stripeInvoiceId })`                                     | Alias for getInvoice                                                                       |
| `listInvoices(ctx, { stripeAccountId?, userId?, subscriptionId?, status?, limit? })` | List invoices with optional filters                                                        |
| `listInvoicesByUser(ctx, { userId })`                                                | List all invoices for a user                                                               |
| `getInvoiceFromStripe(ctx, { stripeInvoiceId })`                                     | Fetch latest invoice data directly from Stripe                                             |
| `listPaymentMethods(ctx, { stripeCustomerId, type? })`                               | List saved payment methods                                                                 |
| `attachPaymentMethod(ctx, { paymentMethodId, stripeCustomerId })`                    | Attach a payment method to a customer account                                              |
| `detachPaymentMethod(ctx, { paymentMethodId })`                                      | Detach a payment method                                                                    |
| `setDefaultPaymentMethod(ctx, { stripeAccountId, paymentMethodId })`                 | Not supported for V2 accounts — throws with guidance to use `createBillingPortalSession()` |
| `createBillingPortalSession(ctx, { stripeAccountId, returnUrl })`                    | Create a Stripe billing portal session URL                                                 |
| `createPayout(ctx, { stripeAccountId, amount, currency?, metadata? })`               | Create a payout for a Connect account                                                      |
| `getPayout(ctx, { payoutId })`                                                       | Get payout by component document ID                                                        |
| `listPayouts(ctx, { stripeAccountId?, status?, limit? })`                            | List payouts with optional filters                                                         |

### Refund and Dispute

| Method                                                                                                          | Description                                                                      |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `createRefund(ctx, { stripePaymentIntentId?, stripeChargeId?, amount?, reason?, metadata?, stripeAccountId?, refundApplicationFee?, reverseTransfer? })` | Issue a refund (provide a payment intent or charge); returns/reverses the platform fee and destination transfer by default; synced via `refund.created`/`.updated` |
| `getRefundByStripeId(ctx, { stripeRefundId })`                                                                  | Get a refund by Stripe refund ID                                                 |
| `listRefunds(ctx, { stripeAccountId?, stripePaymentIntentId?, status?, limit? })`                               | List refunds with optional filters                                               |
| `getDisputeByStripeId(ctx, { stripeDisputeId })`                                                                | Get a dispute by Stripe dispute ID                                               |
| `getDisputeWithCountdown(ctx, { stripeDisputeId })`                                                             | Get a dispute plus its evidence-due countdown (`daysRemaining`, `isOverdue`)      |
| `listDisputes(ctx, { stripeAccountId?, stripePaymentIntentId?, status?, limit? })`                              | List disputes with optional filters                                              |
| `updateDispute(ctx, { stripeDisputeId, evidence?, metadata?, submit?, stripeAccountId? })`                      | Submit/stage dispute evidence (`submit: true` finalizes the response)            |
| `closeDispute(ctx, { stripeDisputeId, stripeAccountId? })`                                                      | Accept a dispute (concede the chargeback) — irreversible                         |
| `reverseTransfers(ctx, { sourceChargeId, percent?, amount? })`                                                  | Reverse split/destination transfers for a charge (the primitive behind automatic dispute clawback; also callable manually) |

Refunds denormalize cumulative state onto the linked `payments` row (`refundedAmount`, `refundStatus: "partially_refunded" | "fully_refunded"`) so "is this payment whole?" is a single read.

### Operational

| Method                                                                                    | Description                                                                     |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `syncAllAccounts(ctx)`                                                                    | Sync all V2 accounts from Stripe to component DB                                |
| `syncAllProducts(ctx)`                                                                    | Sync all products and prices from Stripe                                        |
| `syncAllSubscriptions(ctx)`                                                               | Sync all subscriptions from Stripe                                              |
| `setupEventDestination(ctx, { url, eventPayload?, name?, description?, enabledEvents? })` | Create or update a V2 event destination (snapshot or thin)                      |
| `listEventDestinations(ctx, { limit? })`                                                  | List all V2 event destinations                                                  |
| `listWebhookEndpoints(ctx, { limit? })`                                                   | List V1 webhook endpoints                                                       |
| `createWebhookEndpoint(ctx, { url, description?, enabledEvents? })`                       | Create a V1 webhook endpoint                                                    |
| `webhookHandlers()`                                                                       | Returns the `{ syncWebhook, asyncWebhook }` pair to export from a Convex module |

### Standalone Function

| Function                                   | Description                                                |
| ------------------------------------------ | ---------------------------------------------------------- |
| `registerRoutes(http, component, options)` | Register the webhook HTTP endpoint on a Convex HTTP router |

## Webhook API

### registerRoutes

Register the webhook endpoint on your Convex HTTP router:

```typescript
import { registerRoutes } from "@fantastic.dev/better-stripe";

registerRoutes(http, components.betterStripe, {
  webhookPath: "/stripe/webhook", // Default path
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  webhookSecretV2: process.env.STRIPE_WEBHOOK_SECRET_V2, // For V2 thin events
  webhooks: internal.stripe, // The { syncWebhook, asyncWebhook } pair from webhookHandlers()
  events: { ... }, // Optional per-event handlers (advanced)
  onEvent: (ctx, event) => { ... }, // Optional catch-all handler (advanced)
});
```

### Webhook Setup

Stripe event destinations come in two flavors that cannot be mixed:

- **Snapshot** (`event_payload: 'snapshot'`) — V1 events include the full object in the payload. Used for payments, subscriptions, invoices, products, and payouts.
- **Thin** (`event_payload: 'thin'`) — V2 events include only the event type and object reference. The handler fetches the full object from the Stripe API. Used for Connect account lifecycle events.

You need **two** event destinations pointing to the same webhook URL, each with its own signing secret.

#### Programmatic setup

Use `setupEventDestination()` to create or update destinations:

```typescript
// Create V1 snapshot destination
const v1 = await stripe.setupEventDestination(ctx, {
  url: webhookUrl,
  eventPayload: "snapshot",
});

// Create V2 thin destination
const v2 = await stripe.setupEventDestination(ctx, {
  url: webhookUrl,
  eventPayload: "thin",
});
```

The method is idempotent — it finds an existing destination matching the URL and payload type, updates its events, or creates a new one.

#### Admin UI setup

The example app includes an `/admin/setup` page that handles webhook creation, env var verification, demo data seeding, and Stripe data syncing — all from the browser.

#### Event constants

```typescript
import {
  BETTER_STRIPE_WEBHOOK_EVENTS, // V1 snapshot events (20 events)
  BETTER_STRIPE_V2_WEBHOOK_EVENTS, // V2 thin events (12 events)
  ALL_BETTER_STRIPE_EVENTS, // Combined (32 events)
} from "@fantastic.dev/better-stripe";
```

### Event Processing

Records synced from Stripe objects without `userId` metadata are stored unattributed (`userId: ""`) and are not returned by user-scoped queries.

The webhook handler processes events through these steps:

1. Verify Stripe signature
2. Record the event in the `webhookEvents` ledger by `stripeEventId`. If the event was already seen and is `processing`, `processed`, or `ignored`, return 200 immediately. If the previous delivery `failed` (its writes rolled back), the ledger row is reset and the event is reprocessed on Stripe's retry.
3. Upsert the component-owned domain table. When `webhooks` is configured, the upsert runs through `syncWebhook` — an internal mutation that performs the upsert **and** the sync trigger in the same transaction.
4. On failure, mark the ledger row `failed` and return 500 so Stripe retries; otherwise mark it `processed`
5. Schedule the matching `after*` async hook via `ctx.scheduler` (separate action)

### Ledger-Based Deduplication

The component maintains a `webhookEvents` table that tracks every event by its Stripe event ID. This provides:

- **Replay protection** -- duplicate events are detected and skipped
- **Retry recovery** -- events whose processing failed (and rolled back) are reprocessed when Stripe retries, instead of deduplicating forever
- **Crash recovery** -- if a delivery dies mid-processing (timeout, restart), the `processing` row goes stale after 10 minutes and the event is reprocessed on Stripe's next retry instead of deduplicating forever
- **Failure tracking** -- failed events are marked with status and error message
- **Observability** -- all events (including unsupported types) are logged with `ignored` status

### Supported Events

**Accounts V2 (thin events -- component fetches latest state, requires V2 event destination):**

- `v2.core.account.created`, `.updated`
- `v2.core.account[identity].updated`
- `v2.core.account[requirements].updated`
- `v2.core.account[configuration.merchant].updated`, `.capability_status_updated`
- `v2.core.account[configuration.customer].updated`
- `v2.core.account[configuration.recipient].updated`
- `v2.core.account[defaults].updated`
- `v2.core.account_person.created`, `.updated`
- `v2.core.account_link.returned`

**Billing (snapshot events -- payload contains full state):**

- `checkout.session.completed`
- `customer.subscription.created`, `.updated`, `.deleted`, `.trial_will_end`
- `invoice.created`, `.finalized`, `.paid`, `.payment_failed`
- `payment_intent.succeeded`, `.payment_failed`, `.canceled`
- `payout.created`, `.updated`, `.paid`, `.failed`
- `refund.created`, `.updated`, `.failed`
- `application_fee.refunded` -- keeps `feeCollectedAmount`/`feeRefundedAmount` accurate on the linked payment
- `charge.dispute.created`, `.updated`, `.closed`, `.funds_withdrawn`, `.funds_reinstated`
- `product.created`, `.updated`
- `price.created`, `.updated`

Note: Subscription and invoice events use v1 Billing API event names even when the billing entity is a V2 account referenced via `customer_account`.

## Trigger API

The trigger system follows the BetterAuth pattern: define callbacks at client init time, export the `syncWebhook`/`asyncWebhook` pair via `webhookHandlers()`, and pass their function references to `registerRoutes` via `webhooks`.

### SyncTriggers

Sync triggers run in the same transaction as the component's database write. They must be DB-only and idempotent. Throwing from a sync trigger rolls back the entire transaction (including the component upsert), causing Stripe to retry the webhook.

```typescript
interface SyncTriggers {
  account?: {
    onCreate?: (ctx, doc) => Promise<void>;
    onUpdate?: (ctx, newDoc, oldDoc) => Promise<void>;
  };
  subscription?: {
    onCreate?: (ctx, doc) => Promise<void>;
    onUpdate?: (ctx, newDoc, oldDoc) => Promise<void>;
    onDelete?: (ctx, doc) => Promise<void>;
  };
  checkoutSession?: {
    onCompleted?: (ctx, doc) => Promise<void>;
  };
  product?: {
    onCreate?: (ctx, doc) => Promise<void>;
    onUpdate?: (ctx, newDoc, oldDoc) => Promise<void>;
  };
  price?: {
    onCreate?: (ctx, doc) => Promise<void>;
    onUpdate?: (ctx, newDoc, oldDoc) => Promise<void>;
  };
  invoice?: {
    onCreate?: (ctx, doc) => Promise<void>;
    onUpdate?: (ctx, newDoc, oldDoc) => Promise<void>;
  };
  payment?: {
    onCreate?: (ctx, doc) => Promise<void>;
  };
  payout?: {
    onCreate?: (ctx, doc) => Promise<void>;
    onUpdate?: (ctx, newDoc, oldDoc) => Promise<void>;
  };
  refund?: {
    onCreate?: (ctx, doc) => Promise<void>;
    onUpdate?: (ctx, newDoc, oldDoc) => Promise<void>;
  };
  dispute?: {
    onCreate?: (ctx, doc) => Promise<void>;
    onUpdate?: (ctx, newDoc, oldDoc) => Promise<void>;
  };
}
```

### AsyncHooks

Async hooks run after the component's database write commits, in a separate scheduled action. Use these for external API calls (email, Slack, analytics). Failures do not roll back the component write.

```typescript
interface AsyncHooks {
  onAccountUpdated?: (ctx, account) => Promise<void>;
  onCheckoutCompleted?: (ctx, session) => Promise<void>;
  onSubscriptionUpdated?: (ctx, subscription) => Promise<void>;
  onSubscriptionCanceled?: (ctx, subscription) => Promise<void>;
  onTrialEnding?: (ctx, subscription) => Promise<void>;
  onInvoicePaid?: (ctx, invoice) => Promise<void>;
  onInvoicePaymentFailed?: (ctx, invoice) => Promise<void>;
  onPaymentSucceeded?: (ctx, payment) => Promise<void>;
  onPaymentFailed?: (ctx, payment) => Promise<void>;
  onPayoutCompleted?: (ctx, payout) => Promise<void>;
  onRefundCreated?: (ctx, refund) => Promise<void>;
  onDisputeCreated?: (ctx, dispute) => Promise<void>;
  onDisputeClosed?: (ctx, dispute) => Promise<void>;
}
```

### webhookHandlers()

Returns the `{ syncWebhook, asyncWebhook }` pair that bridges your app callbacks into the webhook processing pipeline. Export them from a Convex module (e.g. `convex/stripe.ts`) so they get function references the webhook handler can call:

```typescript
export const { syncWebhook, asyncWebhook } = stripe.webhookHandlers();
```

Then pass the module to `registerRoutes` as `webhooks: internal.stripe`.

**How `syncWebhook` works.** It is a single internal mutation that routes by a `dispatcher` discriminator to perform the component table upsert **and** your configured sync trigger inside one transaction. It reads the existing doc (to decide `onCreate` vs `onUpdate` and supply `oldDoc`), runs the upsert, re-reads the doc, and invokes your trigger. If the trigger throws, the whole mutation — including the component write — rolls back, the webhook handler marks the ledger row `failed`, and returns 500 so Stripe retries. On retry, failed ledger rows are reset and the event is reprocessed.

**How `asyncWebhook` works.** It is a single internal action that routes by a `hook` discriminator. After the `syncWebhook` transaction commits and the ledger marks the event `processed`, the webhook handler schedules `asyncWebhook` via `ctx.scheduler` with the committed doc. Hook failures never roll back the component write.

Exactly one hook (at most) is scheduled per event:

| Stripe event                                      | Scheduled hook              |
| ------------------------------------------------- | --------------------------- |
| `v2.core.account*` (all account lifecycle events) | `afterAccountUpdated`       |
| `checkout.session.completed`                      | `afterCheckoutCompleted`    |
| `customer.subscription.created` / `.updated`      | `afterSubscriptionUpdated`  |
| `customer.subscription.deleted`                   | `afterSubscriptionCanceled` |
| `customer.subscription.trial_will_end`            | `afterTrialEnding`          |
| `invoice.paid`                                    | `afterInvoicePaid`          |
| `invoice.payment_failed`                          | `afterInvoicePaymentFailed` |
| `payment_intent.succeeded`                        | `afterPaymentSucceeded`     |
| `payment_intent.payment_failed`                   | `afterPaymentFailed`        |
| `payout.paid`                                     | `afterPayoutCompleted`      |
| `refund.created`                                  | `afterRefundCreated`        |
| `charge.dispute.created`                          | `afterDisputeCreated`       |
| `charge.dispute.closed`                           | `afterDisputeClosed`        |

All other processed events (e.g. `payment_intent.canceled`, `payout.failed`, `invoice.created`, `refund.updated`, `charge.dispute.funds_withdrawn`) update the component tables but schedule no hook.

> **Note:** async hooks should be idempotent. Duplicate delivery is possible in rare ledger-failure cases (e.g. the event is processed and the hook scheduled, but the ledger update fails and Stripe redelivers).

The raw callbacks you pass to `triggers` and `hooks` on the `BetterStripe` constructor are the source of truth for app behavior. The exported `syncWebhook`/`asyncWebhook` pair is the bridge that makes them callable from the Convex runtime — events whose triggers you did not configure simply run the upsert (no sync trigger) and schedule no hook.

### Dunning & smart retries

Failed recurring payments are recovered by **Stripe Smart Retries**, not by any retry loop in this library. The component never re-attempts a charge itself — it tracks the delinquency and fires hooks so your app can notify the customer. Retry _timing and count_ are owned entirely by Stripe.

**Required Dashboard settings** (Stripe controls the schedule; enable these once):

- **Subscriptions:** Dashboard → **Billing → Revenue recovery → Retries** — turn on **Smart Retries** (Stripe's recommended, ML-timed schedule). Also set what happens when retries are exhausted (leave `past_due`, mark `unpaid`, or cancel).
- **One-time invoices:** Dashboard → **Settings → Billing → Invoices** — configure retry behavior for invoices not tied to a subscription.
- Ensure the `invoice.payment_failed` and `customer.subscription.updated` events are delivered to your webhook endpoint.

**What the component surfaces:**

- The subscription row tracks Stripe's delinquency states — `past_due` (first failed charge) and `unpaid` (retries exhausted) — arriving via `customer.subscription.updated`, which fires **`onSubscriptionUpdated`**.
- Each `invoice.payment_failed` fires **`onInvoicePaymentFailed`** with the committed invoice. Under Smart Retries the invoice carries `nextPaymentAttempt` (ISO time of Stripe's next retry) and `attemptCount`, so a dunning email can tell the buyer exactly when Stripe will try again. Both clear once the invoice is paid or retries stop.

`onInvoicePaymentFailed` is the **invoice-level** (subscription-cycle) failure — distinct from `onPaymentFailed`, which fires on a one-time **PaymentIntent** failure (`payment_intent.payment_failed`) and receives a payment, not an invoice.

> **Limitation:** `nextPaymentAttempt` is captured from the `invoice.payment_failed` payload, which is correct for Smart Retries. If you instead use a **custom retry _automation_**, Stripe sets `next_payment_attempt` on `invoice.updated` (not `invoice.payment_failed`); the component does not currently process `invoice.updated`, so the retry timestamp may lag until the next handled invoice event.

## Marketplace Economics

The platform is always the merchant of record (Skool-style marketplace model): sellers are Connect recipients, not merchants. This section covers the fee, split, payout, dispute, and refund/descriptor primitives that implement that model. All amounts are minor units (cents).

### Fee Model

`PlatformFeeConfig` is the platform's take on a sale:

```typescript
type FeeTier = { upTo: number | null; percent: number; fixed?: number };
type PlatformFeeConfig = {
  percent: number; // base percentage (0–100)
  fixed?: number; // optional fixed surcharge, minor units
  tiers?: FeeTier[]; // optional; overrides the base by charge amount
};
```

Configure a default at construction (`new BetterStripe(component, { platformFee: {...} })`), and/or pass a per-call `fee` override (type `FeeOverride`, same shape as `PlatformFeeConfig`) to `createCheckoutSession`/`createSubscription` — the override wins. `stripe.resolveFee(override?)` resolves the effective config the same way the client does internally, and `stripe.platformFee` reads the configured default back.

```typescript
import { computeFee } from "@fantastic.dev/better-stripe";

const { feeAmount, percentApplied, fixedApplied, tier } = computeFee(2999, {
  percent: 10,
  fixed: 30,
});
```

`computeFee(amount, config)` picks the first tier whose `upTo` covers the amount (a final `upTo: null` is the catch-all), rounds half-up, and caps the fee at the charge amount. It's exported so an app can preview "platform keeps $X" client-side before checkout.

**How the fee is charged** depends on shape and charge type:

- **Percent-only** fees (`isPercentOnlyFee(config)` — no `fixed`, no `tiers`) map directly to Stripe's `application_fee_percent` on the subscription/PaymentIntent — no per-invoice computation needed.
- **Fixed or tiered** fees can't be expressed as a flat Stripe percentage, so they're computed and applied per invoice (`applyPerInvoiceFee`, at `invoice.created`) or per one-time charge (`applyPerChargeFee`) in the webhook processor, via `application_fee_amount`.
- This per-invoice path shares the same first-invoice timing gap as statement descriptors — see [BTS-68](#roadmap--known-gaps).

Fees only apply to **destination charges** (`destinationAccountId` set, or a single-recipient `split`). The **separate-charges-and-transfers** path (multi-recipient `split`) never uses `application_fee` — the platform's cut is realized by transferring less than was charged (see Split Engine below).

### Split Engine

For a sale split across multiple recipients (store + affiliate(s)), pass `split` instead of `destinationAccountId` to `createCheckoutSession`/`createSubscription`:

```typescript
type SplitRecipient = {
  destinationAccountId: string;
  role: "store" | "affiliate" | "other";
  amount?: number; // exactly one of amount/percent
  percent?: number; // percent of the gross charge amount
};

await stripe.createCheckoutSession(ctx, {
  userId,
  stripePriceId,
  mode: "payment",
  returnUrl,
  split: [
    { destinationAccountId: storeAccountId, role: "store", percent: 80 },
    { destinationAccountId: affiliateAccountId, role: "affiliate", percent: 10 },
  ],
  fee: { percent: 10 }, // per-call override; omit to use the configured default
});
```

- **A single-recipient `split`** is treated as a plain destination charge (equivalent to `destinationAccountId`) — `application_fee_percent`/`application_fee_amount` applies as above.
- **A multi-recipient `split`** routes via **separate charges & transfers**: the platform charges the full amount, then the webhook engine (`createSplitTransfers`, on `payment_intent.succeeded`/`invoice.paid`) creates one Stripe `Transfer` per recipient with `source_transaction` linkage. No `application_fee` is used on this path — the platform's cut is the remainder after transfers.
- **Subscriptions** re-run the split on every billing cycle (each invoice re-reads the subscription's `split`/`feeConfig` markers), so per-cycle recipient amounts stay in sync with the config at charge time.

The core math is exported for previewing splits client-side:

```typescript
import { computeSplit } from "@fantastic.dev/better-stripe";

const result = computeSplit(10000, { percent: 10 }, [
  { destinationAccountId: "acct_store", role: "store", percent: 80 },
  { destinationAccountId: "acct_affiliate", role: "affiliate", percent: 10 },
]);
// result.transfers: [{ destinationAccountId, role, amount }, ...]
// result.platformFee: the resolver's cut; result.platformRetained: amount − sum(transfers)
```

`computeSplit` throws if the transfers plus the platform fee would exceed the charge amount — the platform is always left with at least its configured cut. Any rounding remainder stays with the platform.

### Payouts

Payouts are **automatic and rolling** (Stripe-managed schedule, via hosted Express onboarding) — there is no manual-withdrawal API. `listPayouts`/`createPayout` track/trigger payouts for a Connect account; `PayoutSchedule` (React) and `useEarnings` (React) surface the recipient's balance and next expected payout, with a link out to the hosted Express dashboard for details. See [React Hooks](#react-hooks) and [React Components](#react-components).

### Disputes

The platform is merchant of record, so a chargeback lands on the platform's Stripe account even for a seller's sale. The dispute pipeline (all webhook-driven, on `charge.dispute.*`):

1. **Clawback** — when a dispute opens (`charge.dispute.created`), `reverseTransfers` reverses the split/destination transfers funded by the disputed charge, pro-rata to the disputed amount, so recipients bear their share of the loss. Idempotent via the dispute id.
2. **Reinstatement** — if the dispute is won (`.closed` with `status: "won"`, or `.funds_reinstated`), `reinstateTransfers` re-creates transfers for the amounts clawed back, paying recipients back from the platform balance (Stripe's own reversal is permanent, so winning means paying again).
3. **Auto-cancel** — on dispute open, the disputed subscription (resolved PaymentIntent → invoice → subscription) is canceled by default (`registerRoutes`'s `autoCancelOnDispute`, default `true`; pairs with `cancelDisputeAtPeriodEnd`, default `false` → cancel-at-period-end, matching the Skool model of "cancel now, remove access at cycle end").

Sellers respond to their own disputes without platform staff involvement, via an embedded Stripe Connect session:

```typescript
// server: expose the account session
export const createDisputeSession = action({
  args: { stripeAccountId: v.string() },
  handler: async (ctx, args) => stripe.createDisputeSession(ctx, args),
});
```

`stripe.createDisputeSession(ctx, { stripeAccountId })` creates an Account Session scoped to `disputes_list`/`payment_disputes` — mount it with the `ConnectProvider`/`EmbeddedDisputes` React components (see [Embedded Disputes](#embedded-disputes-stripe-connect)), or build a custom UI on `updateDispute`/`closeDispute` plus the headless `DisputesList`/`DisputeDetail`/`EvidenceForm` components and `buildDisputeEvidence`/`disputeEvidenceCountdown` helpers (see [React Components](#react-components)).

`stripe.reverseTransfers(ctx, { sourceChargeId, percent?, amount? })` is also exposed directly, for manual clawback outside the automatic dispute flow (e.g. a support-initiated partial reversal). The internal engine additionally accepts an `operationId` for a stable Stripe idempotency key (used by the automatic dispute flow); the public method doesn't expose it yet, so a manual call relies on Stripe's default request idempotency.

### Refunds and Statement Descriptors

`createRefund(ctx, { stripePaymentIntentId?, stripeChargeId?, amount?, reason?, refundApplicationFee?, reverseTransfer?, ... })` issues a Stripe refund with marketplace semantics, both defaulting **on**:

- `refundApplicationFee` — return the platform's application fee pro-rata with the refund (destination charges only; Stripe pro-rates partial refunds automatically).
- `reverseTransfer` — pull the refunded amount back from the destination account (destination charges only; also pro-rated for partials).

Stripe hard-errors if either flag is sent for a charge that doesn't carry an application fee / destination transfer, so `createRefund` resolves the charge first and only sends each flag when the charge can honor it. **Split (separate-charges) sales carry neither** — those go through the same charge, so their clawback is webhook-driven: on `refund.created`/`.updated`, `reverseTransfersForRefund` reverses each recipient's ledger leg pro-rata to Stripe's cumulative `amount_refunded`, converging correctly across multiple partial refunds (and coexisting with a prior dispute clawback on the same charge). A separate `application_fee.refunded` handler keeps the linked payment's `feeCollectedAmount`/`feeRefundedAmount` in sync. The `refunds` table and the linked `payments` row update as the corresponding webhooks arrive; `createRefund` itself returns only the new refund id.

Per-store statement descriptors make destination charges recognizable on a buyer's card statement (`PLATFORMPREFIX* SUFFIX`):

```typescript
await stripe.setAccountStatementDescriptor(ctx, {
  stripeAccountId,
  statementDescriptor: "ACME STORE", // or null to clear
});
```

Validated against Stripe's rules (`validateStatementDescriptorSuffix`: 1–22 chars, at least one Latin letter, no `< > \ ' " *`, no non-Latin — rejects rather than truncates) before writing. Resolution order per charge: the store's stored suffix → the platform's configured `statementDescriptorSuffix` default (constructor option) → none. One-time payments set the suffix directly on the PaymentIntent at checkout; subscriptions set it on each invoice via the webhook processor — see [BTS-67](#roadmap--known-gaps) for the one gap in that mechanism (the first subscription charge).

## React Hooks

Import from `@fantastic.dev/better-stripe/react`. All hooks use Convex's `useQuery` and `useMutation` internally.

Read hooks are exported as factory functions that take the app's `useQuery` binding and a query function reference, allowing them to work with any component registration name. Hooks that take a single ID argument accept `undefined` and skip the query (via Convex's `"skip"` sentinel) until the ID is available.

### Read Hooks

| Hook Factory                 | Hook Arguments                             | Returns                                                                                               |
| ---------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `createUseAccount`           | `(userId?)`                                | `{ account, isLoading }`                                                                              |
| `createUseProducts`          | `({ accountId?, active? }?)`               | `{ products, isLoading }`                                                                             |
| `createUsePrices`            | `(productId?)`                             | `{ prices, isLoading }`                                                                               |
| `createUseSubscription`      | `(subscriptionId?)`                        | `{ subscription, isActive, isTrialing, isCanceling, daysUntilRenewal, daysUntilTrialEnd, isLoading }` |
| `createUseSubscriptions`     | `({ userId?, status? }?)`                  | `{ subscriptions, activeSubscription, isLoading }`                                                    |
| `createUseCheckout`          | `(sessionId?)`                             | `{ session, status, isComplete, isLoading }`                                                          |
| `createUsePaymentMethods`    | `(accountId?)`                             | `{ methods, defaultMethod, isLoading }`                                                               |
| `createUseInvoices`          | `({ userId?, subscriptionId?, status? }?)` | `{ invoices, isLoading }`                                                                             |
| `createUseAccountOnboarding` | `(accountId?)`                             | `{ account, status, isReady, missingRequirements, isLoading }`                                        |
| `createUseEarnings`          | `(accountId?)`                             | `{ gross, reversed, net, payouts, paidOut, transfers, isLoading }` — recipient balance/earnings (BTS-36) |
| `createUseSplitBreakdown`    | `({ sourceChargeId?, saleAmount? })`       | `{ breakdown: { legs, store, affiliate, other, recipientsTotal, platform? } \| null, isLoading }` — per-sale split (BTS-36) |
| `createUseDisputes`          | `({ accountId?, status? }?)`               | `{ disputes, isLoading }`                                                                              |
| `createUseDisputeWithCountdown` | `(stripeDisputeId?)`                    | `{ dispute, countdown: { dueBy?, daysRemaining?, isOverdue } \| null, isLoading }`                      |

### Checkout Session Hooks

For Stripe Checkout Session custom UI flows (CheckoutProvider-based):

| Hook / Component          | Description                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `CheckoutSessionProvider` | Provider wrapping Stripe's `CheckoutProvider`. Accepts `publishableKey`, `clientSecret`, `appearance`.      |
| `useCheckoutSession()`    | Returns `{ type, sessionId, canConfirm, confirm(opts?) }` — discriminated union for checkout state/actions. |

```tsx
import {
  CheckoutSessionProvider,
  PaymentElement,
  useCheckoutSession,
} from "@fantastic.dev/better-stripe/react";

<CheckoutSessionProvider publishableKey={pk} clientSecret={token}>
  <MyForm />
</CheckoutSessionProvider>;

function MyForm() {
  const checkout = useCheckoutSession();
  if (checkout.type !== "success") return <Spinner />;
  return (
    <>
      <PaymentElement />
      <button
        disabled={!checkout.canConfirm}
        onClick={() => checkout.confirm()}
      >
        Pay
      </button>
    </>
  );
}
```

### Payment Confirmation Hooks

| Hook                  | Description                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| `useConfirmPayment()` | Provides `confirmPayment(clientSecret)`, `confirmCardSetup(clientSecret)`, `confirmSetup(returnUrl?)` |

All return `{ success: true } | { success: false, error: string }`.

### Payment Method Action Hooks

| Hook                          | Description                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `usePaymentMethodActions(cb)` | Provides `createAndAttach()`, `detach(id)`, `setDefault(id)` with loading/error state |

Accepts app-provided callbacks for backend operations (attach, detach, setDefault, reload).

### Theming

| API                              | Description                                                               |
| -------------------------------- | ------------------------------------------------------------------------- |
| `createStripeAppearance(config)` | Factory: color tokens → Stripe `Appearance` object                        |
| `createStripeElementStyles(cfg)` | Factory: color tokens → inline `style` for CardNumber/Expiry/CVC elements |
| `defaultStripeAppearance`        | Light preset                                                              |
| `darkStripeAppearance`           | Dark preset                                                               |

### Re-exported Stripe Elements

These are re-exported so apps never need to import from `@stripe/react-stripe-js` directly:

`PaymentElement`, `CardElement`, `CardNumberElement`, `CardExpiryElement`, `CardCvcElement`

## React Components

Import from `@fantastic.dev/better-stripe/react`. All components are headless by default -- they provide behavior and minimal structure. Style them with Tailwind or any CSS approach.

All components accept:

- `theme?: Stripe.Appearance` -- Stripe Appearance API object for styling
- `className?: string` -- outer wrapper styling
- String props for i18n with English defaults (e.g., `submitLabel?: string`)
- Standard React props (`children`, event handlers)

### Provider

| Component                 | Description                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| `StripeProvider`          | Stripe Elements context provider. Accepts `publishableKey` prop.                                 |
| `CheckoutSessionProvider` | Checkout Session context provider for custom UI flows. Accepts `publishableKey`, `clientSecret`. |

### Checkout and Subscription

| Component               | Description                                               |
| ----------------------- | --------------------------------------------------------- |
| `EmbeddedCheckout`      | Headless embedded checkout with render-prop loading state |
| `CheckoutStatus`        | Checkout session status display                           |
| `PricePicker`           | Plan/price selection with render-prop customization       |
| `PriceCard`             | Individual price card (controlled or uncontrolled)        |
| `IntervalSelector`      | Billing interval toggle (month/year)                      |
| `SubscriptionCard`      | Current subscription display                              |
| `SubscriptionLineItems` | Line item breakdown                                       |
| `PriceBadge`            | Price/plan badge                                          |
| `TrialAlert`            | Trial status and renewal alert                            |
| `BillingPortalLink`     | Link/button to Stripe billing portal                      |
| `SubscriptionActions`   | Cancel/reactivate action buttons (status-aware)           |

### Payment Methods

| Component                   | Description                                        |
| --------------------------- | -------------------------------------------------- |
| `AddCardForm`               | Headless add-payment-method form                   |
| `PaymentMethodsList`        | Saved payment methods list with render props       |
| `DeletePaymentMethodDialog` | Remove payment method (app provides dialog chrome) |
| `PaymentMethodActions`      | Per-method set-default/delete actions              |

### Buyer Billing

| Component          | Description                                                            |
| ------------------ | --------------------------------------------------------------------- |
| `BuyerBillingView` | Per-store buyer billing view: subscriptions grouped by store, reusable saved card, embedded card update |

An embedded-only billing surface for buyers: their subscriptions are grouped by
store (each store scoped via the `listSubscriptionsByUserAndStore` /
`groupSubscriptionsByStore` per-store queries) with per-store cancel/reactivate,
alongside the ONE saved payment method that is reusable across every store. The
card is updated in place via an embedded `AddCardForm` slot — no redirect.

```tsx
import {
  BuyerBillingView,
  AddCardForm,
  StripeProvider,
} from "@fantastic.dev/better-stripe/react";
import { groupSubscriptionsByStore } from "@fantastic.dev/better-stripe";

function BuyerBilling({ userId, customerAccount }: Props) {
  const subscriptions = useQuery(api.stripe.listSubscriptionsByUser, { userId });
  const { defaultMethod } = usePaymentMethods(customerAccount);
  const cancel = useMutation(api.stripe.cancelSubscription);
  const reactivate = useMutation(api.stripe.reactivateSubscription);

  return (
    <BuyerBillingView
      // groupSubscriptionsByStore reused, not recomputed
      subscriptions={subscriptions?.map((s) => ({ ...s, id: s.stripeSubscriptionId }))}
      paymentMethod={defaultMethod}
      isLoading={subscriptions === undefined}
      onCancel={(sub) => cancel({ stripeSubscriptionId: sub.id })}
      onReactivate={(sub) => reactivate({ stripeSubscriptionId: sub.id })}
      updateCardSlot={
        <StripeProvider publishableKey={pk}>
          <AddCardForm onSuccess={handleCardSaved} />
        </StripeProvider>
      }
    />
  );
}
```

### Connect and Marketplace

| Component                 | Description                                   |
| ------------------------- | --------------------------------------------- |
| `ConnectStatusBadge`      | Connect verification status badge             |
| `AccountOnboardingCard`   | Connect onboarding progress display           |
| `AccountOnboardingButton` | Continue onboarding action (status-aware)     |
| `AccountCreateCard`       | Create Connect account card                   |
| `AccountCreateButton`     | Create account action with loading state      |
| `AccountLoginCard`        | Login to Connect dashboard card               |
| `AccountLoginButton`      | Dashboard login/open action                   |
| `AccountCloseCard`        | Close/restart account card (status-aware)     |
| `AccountCloseButton`      | Close/restart action with status-aware labels |
| `ConnectRequirements`     | Missing requirements checklist                |

### Payouts and Earnings

| Component          | Description                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `PayoutSchedule`    | Recipient balance + next-payout display, fed by a `balance` snapshot and `listPayouts` rows. Payouts are automatic/rolling — no manual-withdrawal action is offered. |
| `EarningsSummary`   | Gross / reversals & adjustments / net + latest payout, fed by `useEarnings(accountId)`. Reversals cover both deferred fee collection and refund/dispute clawbacks — not a pure fees figure, hence the "Reversals & adjustments" label rather than "Fees". |
| `SplitBreakdown`    | Per-sale store / affiliate / other / platform split lines, fed by `useSplitBreakdown`. The platform line reads "unknown" (not $0) when the hook wasn't given the sale amount. |

### Disputes (headless)

The app-owned alternative to [Embedded Disputes](#embedded-disputes-stripe-connect) below — build a custom dispute UI on the read hooks and these components instead of Stripe's hosted ConnectJS components.

| Component        | Description                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| `DisputesList`    | Sorted-by-deadline dispute list (soonest evidence due-by first, no-deadline last), fed by `useDisputes`          |
| `DisputeDetail`   | Amount, reason, status, evidence-due countdown, and linked transfers for one dispute, fed by `useDisputeWithCountdown` |
| `EvidenceForm`    | Plain-language evidence form (product description, access activity, additional info, customer communication) that maps through `buildDisputeEvidence` before calling an app-wired `onUpdateDispute`; `stage()` saves a draft, `submit()` finalizes |

### Embedded Disputes (Stripe Connect)

The Stripe-hosted alternative to the headless dispute components: each seller
views and responds to their own disputes via Stripe's embedded `disputes_list`
/ `payment_disputes` components, driven by the Account Session that
`createDisputeSession` creates.

| Component          | Description                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `ConnectProvider`  | Initializes ConnectJS with your publishable key + an account-session fetcher                    |
| `EmbeddedDisputes` | Mounts the embedded `disputes_list` (or `payment_disputes` when scoped via `payment`) component |

**Dependencies:** the wrapper uses [`@stripe/react-connect-js`](https://www.npmjs.com/package/@stripe/react-connect-js) and [`@stripe/connect-js`](https://www.npmjs.com/package/@stripe/connect-js), which ship as regular dependencies of this package (same convention as `@stripe/react-stripe-js` / `@stripe/stripe-js`) -- no extra install step. ConnectJS components are client-only iframes; render them in client components.

```tsx
// convex/stripe.ts — expose the account session (server side, BTS-30)
export const createDisputeSession = action({
  args: { stripeAccountId: v.string() },
  handler: async (ctx, args) => stripe.createDisputeSession(ctx, args),
});

// Seller disputes page (client side)
import { ConnectProvider, EmbeddedDisputes } from "@fantastic.dev/better-stripe/react";

function SellerDisputes({ stripeAccountId }: { stripeAccountId: string }) {
  const createSession = useAction(api.stripe.createDisputeSession);
  return (
    <ConnectProvider
      publishableKey={import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY}
      fetchClientSecret={async () =>
        (await createSession({ stripeAccountId })).clientSecret
      }
    >
      <EmbeddedDisputes />
    </ConnectProvider>
  );
}
```

## Testing Utilities

Import from `@fantastic.dev/better-stripe/testing`.

### assertTestEnvironment

Guards against running test fixtures with live Stripe keys:

```typescript
import { assertTestEnvironment } from "@fantastic.dev/better-stripe/testing";

assertTestEnvironment(); // Throws if STRIPE_SECRET_KEY does not start with sk_test_
```

### Fixture Factories

Typed factories for creating Stripe test data:

```typescript
import {
  createTestAccount,
  createTestPrice,
  createTestProduct,
  createTestSubscription,
} from "@fantastic.dev/better-stripe/testing";

const account = await createTestAccount(stripe, { email: "test@example.com" });
const product = await createTestProduct(stripe, { name: "Pro Plan" });
const price = await createTestPrice(stripe, {
  productId: product.id,
  unitAmount: 2999,
  interval: "month",
});
```

### Mock Webhook Events

Factories for creating mock webhook events in tests:

```typescript
import {
  mockAccountUpdated,
  mockCheckoutCompleted,
  mockInvoicePaid,
  mockSubscriptionUpdated,
} from "@fantastic.dev/better-stripe/testing";

const event = mockCheckoutCompleted({
  stripeSessionId: "cs_test_123",
  metadata: { userId: "user_abc" },
});
```

## Configuration

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

The component pins the Stripe API version internally (`2026-05-27.dahlia`). Upgrading the pinned version requires a package release and changelog entry. Apps do not need to set `STRIPE_API_VERSION`.

### SDK Management

The component owns the Stripe SDK instance internally via a keyed client cache (keyed by API key). Apps pass `STRIPE_SECRET_KEY`; the component handles versioning and client lifecycle. Apps should not create their own Stripe SDK instances for operations that go through the component.

## Architecture

### Component-Owned Tables

The component manages 8 domain tables and 1 internal table:

| Table              | Description                                              |
| ------------------ | -------------------------------------------------------- |
| `accounts`         | V2 account records with identity and configuration state |
| `products`         | Stripe products with optional trial day management       |
| `prices`           | Stripe prices linked to products                         |
| `subscriptions`    | Subscription lifecycle with first-class trial tracking   |
| `checkoutSessions` | Checkout session state (embedded and redirect)           |
| `invoices`         | Invoice records with subscription metadata               |
| `payments`         | Payment intent records                                   |
| `payouts`          | Payout records for Connect/marketplace                   |
| `webhookEvents`    | Internal ledger for replay protection and observability  |

### App-Layer Tables

The consuming app maintains its own tables for business context. The component never reads or writes app tables directly. App tables are updated via sync triggers that run in the same transaction as component writes.

Example app-layer tables (from a typical integration):

- Linking products to app-specific entities (e.g., communities, teams)
- Linking subscriptions to app-specific purchase types
- Payout percentage configurations

### Trigger Flow

```
Stripe Webhook Event
  |
  v
Webhook handler: Verify signature + check ledger
  |
  v
syncWebhook (one mutation transaction)
  - Upsert component domain table
  - Run sync trigger                   --> App updates its own tables
  |                                        Throwing rolls back the upsert;
  |                                        Stripe retries and the failed
  |                                        ledger row is reprocessed
  v
Mark ledger row processed
  |
  v
Async hook (scheduled action)          --> App calls external APIs
                                           Failures do not roll back;
                                           hooks should be idempotent
```

### Package Entry Points

| Entry Point                            | Contents                                                 |
| -------------------------------------- | -------------------------------------------------------- |
| `@fantastic.dev/better-stripe`               | `BetterStripe` class, `registerRoutes`, TypeScript types |
| `@fantastic.dev/better-stripe/react`         | React hooks, headless UI components, formatting helpers  |
| `@fantastic.dev/better-stripe/testing`       | Test fixtures, mock webhooks, `assertTestEnvironment`    |
| `@fantastic.dev/better-stripe/convex.config` | Convex component registration                            |

### Error Handling

Structured errors are thrown as `ConvexError` with a `BetterStripeError` payload:

```typescript
interface BetterStripeError {
  code: BetterStripeErrorCode;
  message: string;
  stripeError?: {
    type: string;
    code?: string;
    message: string;
  };
}
```

Error codes: `ACCOUNT_NOT_FOUND`, `ACCOUNT_CREATE_FAILED`, `PRODUCT_NOT_FOUND`, `PRICE_NOT_FOUND`, `SUBSCRIPTION_NOT_FOUND`, `SUBSCRIPTION_UPDATE_FAILED`, `CHECKOUT_CREATE_FAILED`, `CHECKOUT_NOT_FOUND`, `PAYMENT_METHOD_FAILED`, `WEBHOOK_VERIFICATION_FAILED`, `WEBHOOK_DUPLICATE_EVENT`, `STRIPE_API_ERROR`, `TEST_ENV_REQUIRED`, `INVALID_CONFIGURATION`.

> **Note:** All methods that throw their own errors or catch-and-rethrow now use structured `ConvexError(BetterStripeError)` payloads. Methods that let uncaught Stripe SDK errors propagate are a separate policy decision and not yet aligned.

## Resources

- [Stripe V2 Accounts API](https://docs.stripe.com/connect/accounts-v2/api)
- [Stripe Embedded Checkout](https://docs.stripe.com/payments/checkout/custom)
- [Convex Component Authoring](https://docs.convex.dev/components/authoring)
- [Stripe Webhook Event Reference](https://docs.stripe.com/api/events/types)
- [Stripe Testing Guide](https://docs.stripe.com/testing)

## License

MIT
