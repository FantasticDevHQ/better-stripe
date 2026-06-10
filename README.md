# better-stripe

A reusable [Convex component](https://docs.convex.dev/components) for the Stripe V2 Accounts API. Provides a complete billing backend with schema, queries, mutations, actions, webhook handling, React hooks, and headless UI components.

Built for Convex + Next.js applications. Follows the conventions established by [`@convex-dev/stripe`](https://github.com/get-convex/stripe) and [`@convex-dev/better-auth`](https://github.com/get-convex/better-auth).

## Features

- **V2 Accounts API** -- Account creation, onboarding, Connect/marketplace, merchant and recipient configurations
- **Products and Prices** -- Full CRUD with trial day management as a first-class feature
- **Checkout** -- Both embedded (custom UI mode) and redirect checkout session creation
- **Subscriptions** -- Lifecycle management including cancel, reactivate, quantity updates, and trial tracking
- **Invoices** -- Invoice syncing and querying with metadata propagation from subscriptions
- **Payments** -- Payment intent tracking and status management
- **Payouts** -- Payout tracking for Connect/marketplace flows
- **Webhook handling** -- Single-endpoint processing with ledger-based deduplication and replay protection
- **Trigger system** -- BetterAuth-style sync triggers (same transaction) and async hooks (scheduled action) for app-layer extensibility
- **React hooks** -- Read hooks and flow hooks for all billing domains
- **Headless UI components** -- Checkout, subscription, payment method, and Connect components with render-prop customization
- **Test utilities** -- Typed fixture factories, mock webhook events, and `assertTestEnvironment` guard

## Installation

```bash
npm install @getdojo/better-stripe
```

The package bundles `stripe`, `@stripe/stripe-js`, and `@stripe/react-stripe-js` as dependencies. You do not need to install Stripe packages separately.

Peer dependencies: `convex >= 1.29.3`, `react >= 18.3.1`, `react-dom >= 18.3.1`.

## Quick Start

The consumer contract has three steps:

### Step 1: Register the component

```typescript
// convex/convex.config.ts
import betterStripe from "@getdojo/better-stripe/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(betterStripe);

export default app;
```

### Step 2: Create a BetterStripe instance with triggers

```typescript
// convex/stripe.ts
import { BetterStripe } from "@getdojo/better-stripe";

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

// Export trigger dispatchers + async hooks; http.ts passes their refs to registerRoutes
export const {
  accountUpserted,
  productUpserted,
  priceUpserted,
  subscriptionUpserted,
  subscriptionDeleted,
  checkoutSessionUpserted,
  invoiceUpserted,
  paymentUpserted,
  payoutUpserted,
  afterAccountUpdated,
  afterCheckoutCompleted,
  afterSubscriptionUpdated,
  afterSubscriptionCanceled,
  afterTrialEnding,
  afterInvoicePaid,
  afterPaymentSucceeded,
  afterPaymentFailed,
  afterPayoutCompleted,
} = stripe.triggersApi();
```

### Step 3: Register webhook routes

```typescript
// convex/http.ts
import { registerRoutes } from "@getdojo/better-stripe";
import { httpRouter } from "convex/server";

import { components, internal } from "./_generated/api";

const http = httpRouter();

registerRoutes(http, components.betterStripe, {
  webhookPath: "/stripe/webhook",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  webhookSecretV2: process.env.STRIPE_WEBHOOK_SECRET_V2,
  triggers: internal.stripe,
});

export default http;
```

The `triggers: internal.stripe` line passes the function references of the dispatchers you exported in step 2 (here from `convex/stripe.ts`). When provided, webhook upserts run through those dispatchers so your sync triggers execute in the same transaction as the component write, and your async hooks are scheduled after commit. If omitted, the handler falls back to direct component upserts and no triggers fire.

> **Why two webhook secrets?** Stripe requires separate event destinations for V1 snapshot events (payments, subscriptions) and V2 thin events (Connect account lifecycle). Each destination has its own signing secret. The handler uses `webhookSecret` for V1 events and `webhookSecretV2` for V2 events. See [Webhook Setup](#webhook-setup) for details.

## Client API Reference

All methods are available on the `BetterStripe` class instance. Methods that call the Stripe API are actions; methods that only read Convex data are queries.

Methods named `get<Entity>` take the component document ID; methods named `get<Entity>ByStripeId` take the Stripe ID (`acct_...`, `prod_...`, `price_...`, `cs_...`, `sub_...`).

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
| `createCheckoutSession(ctx, { userId, stripePriceId, mode, returnUrl, uiMode?, quantity?, trialDays?, accountId?, orgId?, customerEmail?, metadata?, sessionOverrides? })` | Create checkout session (embedded or redirect)                                                                    |
| `getCheckoutSession(ctx, { sessionId })`                                                                                                                                   | Get checkout session by component document ID                                                                     |
| `getCheckoutSessionByStripeId(ctx, { stripeSessionId })`                                                                                                                   | Get checkout session by Stripe session ID                                                                         |
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

### Operational

| Method                                                                                    | Description                                                                               |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `syncAllAccounts(ctx)`                                                                    | Sync all V2 accounts from Stripe to component DB                                          |
| `syncAllProducts(ctx)`                                                                    | Sync all products and prices from Stripe                                                  |
| `syncAllSubscriptions(ctx)`                                                               | Sync all subscriptions from Stripe                                                        |
| `setupEventDestination(ctx, { url, eventPayload?, name?, description?, enabledEvents? })` | Create or update a V2 event destination (snapshot or thin)                                |
| `listEventDestinations(ctx)`                                                              | List all V2 event destinations                                                            |
| `listWebhookEndpoints(ctx)`                                                               | List V1 webhook endpoints                                                                 |
| `createWebhookEndpoint(ctx, { url, description?, enabledEvents? })`                       | Create a V1 webhook endpoint                                                              |
| `triggersApi()`                                                                           | Returns the trigger dispatchers and `after*` hook wrappers to export from a Convex module |

### Standalone Function

| Function                                   | Description                                                |
| ------------------------------------------ | ---------------------------------------------------------- |
| `registerRoutes(http, component, options)` | Register the webhook HTTP endpoint on a Convex HTTP router |

## Webhook API

### registerRoutes

Register the webhook endpoint on your Convex HTTP router:

```typescript
import { registerRoutes } from "@getdojo/better-stripe";

registerRoutes(http, components.betterStripe, {
  webhookPath: "/stripe/webhook", // Default path
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  webhookSecretV2: process.env.STRIPE_WEBHOOK_SECRET_V2, // For V2 thin events
  triggers: internal.stripe, // Trigger dispatchers exported via triggersApi()
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
} from "@getdojo/better-stripe";
```

### Event Processing

The webhook handler processes events through these steps:

1. Verify Stripe signature
2. Record the event in the `webhookEvents` ledger by `stripeEventId`. If the event was already seen and is `processing`, `processed`, or `ignored`, return 200 immediately. If the previous delivery `failed` (its writes rolled back), the ledger row is reset and the event is reprocessed on Stripe's retry.
3. Upsert the component-owned domain table. When `triggers` is configured, the upsert runs through the app's trigger dispatcher — an internal mutation that performs the upsert **and** the sync trigger in the same transaction.
4. On failure, mark the ledger row `failed` and return 500 so Stripe retries; otherwise mark it `processed`
5. Schedule the matching `after*` async hook via `ctx.scheduler` (separate action)

### Ledger-Based Deduplication

The component maintains a `webhookEvents` table that tracks every event by its Stripe event ID. This provides:

- **Replay protection** -- duplicate events are detected and skipped
- **Retry recovery** -- events whose processing failed (and rolled back) are reprocessed when Stripe retries, instead of deduplicating forever
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
- `product.created`, `.updated`
- `price.created`, `.updated`

Note: Subscription and invoice events use v1 Billing API event names even when the billing entity is a V2 account referenced via `customer_account`.

## Trigger API

The trigger system follows the BetterAuth pattern: define callbacks at client init time, export Convex-callable wrappers via `triggersApi()`, and pass their function references to `registerRoutes` via `triggers`.

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
  onPaymentSucceeded?: (ctx, payment) => Promise<void>;
  onPaymentFailed?: (ctx, payment) => Promise<void>;
  onPayoutCompleted?: (ctx, payout) => Promise<void>;
}
```

### triggersApi()

Returns the Convex function definitions that bridge your app callbacks into the webhook processing pipeline. You must export them from a Convex module (e.g. `convex/stripe.ts`) so they get function references the webhook handler can call:

```typescript
export const {
  // Sync dispatchers (internal mutations)
  accountUpserted,
  productUpserted,
  priceUpserted,
  subscriptionUpserted,
  subscriptionDeleted,
  checkoutSessionUpserted,
  invoiceUpserted,
  paymentUpserted,
  payoutUpserted,
  // Async hook wrappers (internal actions)
  afterAccountUpdated,
  afterCheckoutCompleted,
  afterSubscriptionUpdated,
  afterSubscriptionCanceled,
  afterTrialEnding,
  afterInvoicePaid,
  afterPaymentSucceeded,
  afterPaymentFailed,
  afterPayoutCompleted,
} = stripe.triggersApi();
```

Then pass the module to `registerRoutes` as `triggers: internal.stripe`.

**How the dispatchers work.** Each `*Upserted`/`*Deleted` export is an internal mutation that performs the component table upsert **and** your configured sync trigger inside one transaction. The dispatcher reads the existing doc (to decide `onCreate` vs `onUpdate` and supply `oldDoc`), runs the upsert, re-reads the doc, and invokes your trigger. If the trigger throws, the whole mutation — including the component write — rolls back, the webhook handler marks the ledger row `failed`, and returns 500 so Stripe retries. On retry, failed ledger rows are reset and the event is reprocessed.

**How the `after*` hooks work.** Each `after*` export is an internal action. After the dispatcher transaction commits and the ledger marks the event `processed`, the webhook handler schedules the matching hook via `ctx.scheduler` with the committed doc. Hook failures never roll back the component write.

> **Note:** async hooks should be idempotent. Duplicate delivery is possible in rare ledger-failure cases (e.g. the event is processed and the hook scheduled, but the ledger update fails and Stripe redelivers).

The raw callbacks you pass to `triggers` and `hooks` on the `BetterStripe` constructor are the source of truth for app behavior. The exported wrappers are the bridge that makes them callable from the Convex runtime — exports for triggers you did not configure are inert (upsert-only dispatchers and no-op hooks).

## React Hooks

Import from `@getdojo/better-stripe/react`. All hooks use Convex's `useQuery` and `useMutation` internally.

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
} from "@getdojo/better-stripe/react";

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

Import from `@getdojo/better-stripe/react`. All components are headless by default -- they provide behavior and minimal structure. Style them with Tailwind or any CSS approach.

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

## Testing Utilities

Import from `@getdojo/better-stripe/testing`.

### assertTestEnvironment

Guards against running test fixtures with live Stripe keys:

```typescript
import { assertTestEnvironment } from "@getdojo/better-stripe/testing";

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
} from "@getdojo/better-stripe/testing";

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
} from "@getdojo/better-stripe/testing";

const event = mockCheckoutCompleted({
  stripeSessionId: "cs_test_123",
  metadata: { userId: "user_abc" },
});
```

## Configuration

### Environment Variables

| Variable                   | Required    | Description                                                                                                       |
| -------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`        | Yes         | Passed via constructor or `registerRoutes`. Falls back to `process.env.STRIPE_SECRET_KEY`.                        |
| `STRIPE_WEBHOOK_SECRET`    | Yes         | Signing secret for the V1 snapshot event destination.                                                             |
| `STRIPE_WEBHOOK_SECRET_V2` | Yes         | Signing secret for the V2 thin event destination (Connect account events). Falls back to `STRIPE_WEBHOOK_SECRET`. |
| `STRIPE_PUBLISHABLE_KEY`   | Yes (React) | Set in Convex env. Exposed via `getPublishableKey` query. App queries it and passes to `StripeProvider`.          |

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
Trigger dispatcher (one mutation transaction)
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
| `@getdojo/better-stripe`               | `BetterStripe` class, `registerRoutes`, TypeScript types |
| `@getdojo/better-stripe/react`         | React hooks, headless UI components, formatting helpers  |
| `@getdojo/better-stripe/testing`       | Test fixtures, mock webhooks, `assertTestEnvironment`    |
| `@getdojo/better-stripe/convex.config` | Convex component registration                            |

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

Error codes: `ACCOUNT_NOT_FOUND`, `ACCOUNT_CREATE_FAILED`, `PRODUCT_NOT_FOUND`, `PRICE_NOT_FOUND`, `SUBSCRIPTION_NOT_FOUND`, `CHECKOUT_CREATE_FAILED`, `CHECKOUT_NOT_FOUND`, `PAYMENT_METHOD_FAILED`, `WEBHOOK_VERIFICATION_FAILED`, `WEBHOOK_DUPLICATE_EVENT`, `STRIPE_API_ERROR`, `TEST_ENV_REQUIRED`, `INVALID_CONFIGURATION`.

> **Note:** error semantics are not yet uniform across the API. Newer methods such as `createAccountSession` throw structured `ConvexError(BetterStripeError)` payloads, while some older methods propagate raw Stripe SDK errors. Aligning all methods on structured errors is planned.

## Resources

- [Stripe V2 Accounts API](https://docs.stripe.com/connect/accounts-v2/api)
- [Stripe Embedded Checkout](https://docs.stripe.com/payments/checkout/custom)
- [Convex Component Authoring](https://docs.convex.dev/components/authoring)
- [Stripe Webhook Event Reference](https://docs.stripe.com/api/events/types)
- [Stripe Testing Guide](https://docs.stripe.com/testing)

## License

MIT
