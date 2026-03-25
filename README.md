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
- **Trigger system** -- BetterAuth-style sync triggers (same transaction) and async hooks (separate action) for app-layer extensibility
- **React hooks** -- Read hooks and flow hooks for all billing domains
- **Headless UI components** -- Checkout, subscription, payment method, and Connect components with render-prop customization
- **Test utilities** -- Typed fixture factories, mock webhook events, and `assertTestEnvironment` guard

## Installation

```bash
npm install better-stripe
```

The package bundles `stripe`, `@stripe/stripe-js`, and `@stripe/react-stripe-js` as dependencies. You do not need to install Stripe packages separately.

Peer dependencies: `convex >= 1.29.3`, `react >= 18.3.1`, `react-dom >= 18.3.1`.

## Quick Start

The consumer contract has three steps:

### Step 1: Register the component

```typescript
// convex/convex.config.ts
import betterStripe from 'better-stripe/convex.config';
import { defineApp } from 'convex/server';

const app = defineApp();
app.use(betterStripe);

export default app;
```

### Step 2: Create a BetterStripe instance with triggers

```typescript
// convex/billing/stripe.ts
import { BetterStripe } from 'better-stripe';

import { components } from '../_generated/api';

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

// Export Convex-callable wrappers for the trigger system
export const {
  onCheckoutSessionCompleted,
  onSubscriptionUpdated,
  onAccountUpdated,
  afterCheckoutCompleted,
} = stripe.triggersApi();
```

### Step 3: Register webhook routes

```typescript
// convex/http.ts
import { registerRoutes } from 'better-stripe';
import { httpRouter } from 'convex/server';

import { components } from './_generated/api';

const http = httpRouter();

registerRoutes(http, components.betterStripe, {
  webhookPath: '/stripe/webhook',
});

export default http;
```

## Client API Reference

All methods are available on the `BetterStripe` class instance. Methods that call the Stripe API are actions; methods that only read Convex data are queries.

### Account

| Method                                                                     | Description                                              |
| -------------------------------------------------------------------------- | -------------------------------------------------------- |
| `createAccount(ctx, { email, country, userId?, metadata? })`               | Create a V2 account in Stripe and the component database |
| `getAccount(ctx, { stripeAccountId })`                                     | Get account by Stripe account ID                         |
| `getOrCreateAccount(ctx, { email, country, userId?, metadata? })`          | Get existing or create new account                       |
| `getAccountByUserId(ctx, { userId })`                                      | Get account by app-layer user ID                         |
| `getAccountByOrgId(ctx, { orgId })`                                        | Get account by organization/team ID                      |
| `getAccountOnboardingStatus(ctx, { stripeAccountId })`                     | Get Connect onboarding status                            |
| `updateAccount(ctx, { stripeAccountId, ...updates })`                      | Update account fields                                    |
| `createAccountLink(ctx, { stripeAccountId, refreshUrl, returnUrl, type })` | Create Connect onboarding or update link                 |
| `createAccountSession(ctx, { stripeAccountId, components })`               | Create embedded account management session               |
| `createLoginLink(ctx, { stripeAccountId })`                                | Create Express dashboard login link                      |
| `addRecipientConfiguration(ctx, { stripeAccountId })`                      | Add recipient configuration to an existing account       |

### Product and Price

| Method                                                                                       | Description                                   |
| -------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `createProduct(ctx, { name, description?, trialDays?, metadata?, userId? })`                 | Create product in Stripe and component DB     |
| `getProduct(ctx, { stripeProductId })`                                                       | Get product by Stripe product ID              |
| `getProductByStripeId(ctx, { stripeProductId })`                                             | Alias for getProduct                          |
| `listProducts(ctx, { stripeAccountId?, active? })`                                           | List products with optional filters           |
| `updateProduct(ctx, { stripeProductId, ...updates })`                                        | Update product fields                         |
| `deactivateProduct(ctx, { stripeProductId })`                                                | Deactivate product in Stripe and component DB |
| `createPrice(ctx, { stripeProductId, unitAmount, currency, interval?, metadata?, userId? })` | Create price in Stripe and component DB       |
| `getPrice(ctx, { stripePriceId })`                                                           | Get price by Stripe price ID                  |
| `getPriceByStripeId(ctx, { stripePriceId })`                                                 | Alias for getPrice                            |
| `listPrices(ctx, { stripeProductId?, active? })`                                             | List prices with optional filters             |
| `updatePrice(ctx, { stripePriceId, ...updates })`                                            | Update price fields                           |
| `deactivatePrice(ctx, { stripePriceId })`                                                    | Deactivate price in Stripe and component DB   |

### Checkout and Subscription

| Method                                                                                                                                                                         | Description                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `createCheckoutSession(ctx, { stripePriceId, stripeAccountId?, userId?, mode, successUrl?, cancelUrl?, returnUrl?, quantity?, metadata?, subscriptionMetadata?, trialDays? })` | Create checkout session (embedded or redirect)     |
| `getCheckoutSession(ctx, { stripeSessionId })`                                                                                                                                 | Get checkout session by Stripe session ID          |
| `getCheckoutSessionByStripeId(ctx, { stripeSessionId })`                                                                                                                       | Alias for getCheckoutSession                       |
| `getSubscription(ctx, { stripeSubscriptionId })`                                                                                                                               | Get subscription by Stripe subscription ID         |
| `getSubscriptionByStripeId(ctx, { stripeSubscriptionId })`                                                                                                                     | Alias for getSubscription                          |
| `listSubscriptions(ctx, { stripeAccountId?, userId?, status? })`                                                                                                               | List subscriptions with optional filters           |
| `listSubscriptionsByUser(ctx, { userId })`                                                                                                                                     | List all subscriptions for a user                  |
| `listSubscriptionsByOrg(ctx, { orgId })`                                                                                                                                       | List all subscriptions for an organization         |
| `getActiveSubscription(ctx, { stripeAccountId?, userId? })`                                                                                                                    | Get the active subscription for an account or user |
| `getTrialStatus(ctx, { stripeSubscriptionId })`                                                                                                                                | Get trial state for a subscription                 |
| `cancelSubscription(ctx, { stripeSubscriptionId, cancelAtPeriodEnd? })`                                                                                                        | Cancel subscription immediately or at period end   |
| `reactivateSubscription(ctx, { stripeSubscriptionId })`                                                                                                                        | Reactivate a canceled subscription                 |
| `updateSubscriptionQuantity(ctx, { stripeSubscriptionId, quantity })`                                                                                                          | Update subscription seat quantity                  |

### Invoice, Payment Method, and Payout

| Method                                                               | Description                                    |
| -------------------------------------------------------------------- | ---------------------------------------------- |
| `getInvoice(ctx, { stripeInvoiceId })`                               | Get invoice by Stripe invoice ID               |
| `listInvoices(ctx, { stripeAccountId?, userId? })`                   | List invoices with optional filters            |
| `listInvoicesByUser(ctx, { userId })`                                | List all invoices for a user                   |
| `getInvoiceFromStripe(ctx, { stripeInvoiceId })`                     | Fetch latest invoice data directly from Stripe |
| `listPaymentMethods(ctx, { stripeAccountId })`                       | List saved payment methods                     |
| `attachPaymentMethod(ctx, { stripeAccountId, paymentMethodId })`     | Attach a payment method to an account          |
| `detachPaymentMethod(ctx, { paymentMethodId })`                      | Detach a payment method                        |
| `setDefaultPaymentMethod(ctx, { stripeAccountId, paymentMethodId })` | Set the default payment method                 |
| `createBillingPortalSession(ctx, { stripeAccountId, returnUrl })`    | Create a Stripe billing portal session URL     |
| `createPayout(ctx, { stripeAccountId, amount, currency })`           | Create a payout for a Connect account          |
| `getPayout(ctx, { stripePayoutId })`                                 | Get payout by Stripe payout ID                 |
| `listPayouts(ctx, { stripeAccountId })`                              | List payouts for an account                    |

### Operational

| Method                      | Description                                                        |
| --------------------------- | ------------------------------------------------------------------ |
| `syncAllAccounts(ctx)`      | Sync all V2 accounts from Stripe to component DB                   |
| `syncAllProducts(ctx)`      | Sync all products and prices from Stripe                           |
| `syncAllSubscriptions(ctx)` | Sync all subscriptions from Stripe                                 |
| `triggersApi()`             | Returns Convex-callable wrappers for configured triggers and hooks |

### Standalone Function

| Function                                   | Description                                                |
| ------------------------------------------ | ---------------------------------------------------------- |
| `registerRoutes(http, component, options)` | Register the webhook HTTP endpoint on a Convex HTTP router |

## Webhook API

### registerRoutes

Register the webhook endpoint on your Convex HTTP router:

```typescript
import { registerRoutes } from 'better-stripe';

registerRoutes(http, components.betterStripe, {
  webhookPath: '/stripe/webhook',      // Default path
  STRIPE_SECRET_KEY: '...',            // Falls back to env var
  STRIPE_WEBHOOK_SECRET: '...',        // Falls back to env var
  events: { ... },                     // Optional per-event handlers (advanced)
  onEvent: (ctx, event) => { ... },    // Optional catch-all handler (advanced)
});
```

### Event Processing

The webhook handler processes events through these steps:

1. Verify Stripe signature
2. Check `webhookEvents` ledger by `stripeEventId`
3. If already `processed` or `ignored`, return 200 immediately
4. Insert/update ledger row to `processing`
5. Upsert component-owned domain tables
6. Invoke sync trigger wrapper (same transaction, can throw to rollback)
7. Mark ledger row `processed`
8. Schedule async hook wrapper (separate action)

### Ledger-Based Deduplication

The component maintains a `webhookEvents` table that tracks every event by its Stripe event ID. This provides:

- **Replay protection** -- duplicate events are detected and skipped
- **Failure tracking** -- failed events are marked with status and error message
- **Observability** -- all events (including unsupported types) are logged with `ignored` status

### Supported Events

**Accounts V2 (thin events -- component fetches latest state):**

- `v2.core.account.created`
- `v2.core.account[identity].updated`
- `v2.core.account[requirements].updated`
- `v2.core.account[configuration.customer].updated`
- `v2.core.account.closed`

**Billing (snapshot events -- payload contains full state):**

- `checkout.session.completed`
- `customer.subscription.created`, `.updated`, `.deleted`
- `invoice.created`, `.finalized`, `.paid`, `.payment_failed`
- `payment_intent.succeeded`, `.payment_failed`, `.canceled`
- `payout.created`, `.updated`, `.paid`, `.failed`
- `product.created`, `.updated`
- `price.created`, `.updated`

Note: Subscription and invoice events use v1 Billing API event names even when the billing entity is a V2 account referenced via `customer_account`.

## Trigger API

The trigger system follows the BetterAuth pattern: define callbacks at client init time, export Convex-callable wrappers via `triggersApi()`.

### SyncTriggers

Sync triggers run in the same transaction as the component's database write. They must be DB-only and idempotent. Throwing from a sync trigger rolls back the entire transaction, causing Stripe to retry the webhook.

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

Async hooks run after the component's database write commits, in a separate action. Use these for external API calls (email, Slack, analytics). Failures do not roll back the component write.

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

Returns Convex-callable wrappers that bridge your app callbacks into the webhook processing pipeline. You must export these from your billing composition root file:

```typescript
export const {
  onCheckoutSessionCompleted,
  onSubscriptionUpdated,
  onAccountUpdated,
  afterCheckoutCompleted,
} = stripe.triggersApi();
```

The raw callbacks you pass to `triggers` and `hooks` are the source of truth for app behavior. The exported wrappers are the bridge that makes them callable from the Convex runtime.

## React Hooks

Import from `better-stripe/react`. All hooks use Convex's `useQuery` and `useMutation` internally.

Hooks are exported as factory functions that accept the component API reference, allowing them to work with any component registration name.

### Read Hooks

| Hook Factory                 | Arguments          | Returns                                                     |
| ---------------------------- | ------------------ | ----------------------------------------------------------- |
| `createUseAccount`           | `(userId)`         | `{ account, isLoading }`                                    |
| `createUseProducts`          | `(accountId?)`     | `{ products, isLoading }`                                   |
| `createUsePrices`            | `(productId)`      | `{ prices, isLoading }`                                     |
| `createUseSubscription`      | `(subscriptionId)` | `{ subscription, isTrialing, daysUntilRenewal, isLoading }` |
| `createUseSubscriptions`     | `(accountId)`      | `{ subscriptions, activeSubscription, isLoading }`          |
| `createUseCheckout`          | `(sessionId)`      | `{ session, status, isLoading }`                            |
| `createUsePaymentMethods`    | `(accountId)`      | `{ methods, defaultMethod, isLoading }`                     |
| `createUseInvoices`          | `(accountId)`      | `{ invoices, isLoading }`                                   |
| `createUseAccountOnboarding` | `(accountId)`      | `{ status, requirements, isReady, isLoading }`              |

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
} from 'better-stripe/react';

<CheckoutSessionProvider publishableKey={pk} clientSecret={token}>
  <MyForm />
</CheckoutSessionProvider>;

function MyForm() {
  const checkout = useCheckoutSession();
  if (checkout.type !== 'success') return <Spinner />;
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

Import from `better-stripe/react`. All components are headless by default -- they provide behavior and minimal structure. Style them with Tailwind or any CSS approach.

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

### Payment Methods

| Component                   | Description                                        |
| --------------------------- | -------------------------------------------------- |
| `AddCardForm`               | Headless add-payment-method form                   |
| `PaymentMethodsList`        | Saved payment methods list with render props       |
| `DeletePaymentMethodDialog` | Remove payment method (app provides dialog chrome) |

### Connect and Marketplace

| Component               | Description                         |
| ----------------------- | ----------------------------------- |
| `ConnectStatusBadge`    | Connect verification status badge   |
| `AccountOnboardingCard` | Connect onboarding progress display |
| `AccountCreateCard`     | Create Connect account card         |
| `AccountLoginCard`      | Login to Connect dashboard card     |
| `ConnectRequirements`   | Missing requirements checklist      |

## Testing Utilities

Import from `better-stripe/testing`.

### assertTestEnvironment

Guards against running test fixtures with live Stripe keys:

```typescript
import { assertTestEnvironment } from 'better-stripe/testing';

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
} from 'better-stripe/testing';

const account = await createTestAccount(stripe, { email: 'test@example.com' });
const product = await createTestProduct(stripe, { name: 'Pro Plan' });
const price = await createTestPrice(stripe, {
  productId: product.id,
  unitAmount: 2999,
  interval: 'month',
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
} from 'better-stripe/testing';

const event = mockCheckoutCompleted({
  stripeSessionId: 'cs_test_123',
  metadata: { userId: 'user_abc' },
});
```

## Configuration

### Environment Variables

| Variable                 | Required    | Description                                                                                              |
| ------------------------ | ----------- | -------------------------------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`      | Yes         | Passed via constructor or `registerRoutes`. Falls back to `process.env.STRIPE_SECRET_KEY`.               |
| `STRIPE_WEBHOOK_SECRET`  | Yes         | Passed to `registerRoutes`. Falls back to `process.env.STRIPE_WEBHOOK_SECRET`.                           |
| `STRIPE_PUBLISHABLE_KEY` | Yes (React) | Set in Convex env. Exposed via `getPublishableKey` query. App queries it and passes to `StripeProvider`. |

### Stripe API Version

The component pins the Stripe API version internally (`2026-02-25.clover`). Upgrading the pinned version requires a package release and changelog entry. Apps do not need to set `STRIPE_API_VERSION`.

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
Component: Verify signature + check ledger
  |
  v
Component: Upsert domain table
  |
  v
Sync Trigger (same transaction)        --> App updates its own tables
  |                                         Can throw to rollback everything
  v
Commit
  |
  v
Async Hook (scheduled action)          --> App calls external APIs
                                            Failures do not roll back
```

### Package Entry Points

| Entry Point                   | Contents                                                 |
| ----------------------------- | -------------------------------------------------------- |
| `better-stripe`               | `BetterStripe` class, `registerRoutes`, TypeScript types |
| `better-stripe/react`         | React hooks, headless UI components, formatting helpers  |
| `better-stripe/testing`       | Test fixtures, mock webhooks, `assertTestEnvironment`    |
| `better-stripe/convex.config` | Convex component registration                            |

### Error Handling

All errors are thrown as `ConvexError` with a structured payload:

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

Error codes: `ACCOUNT_NOT_FOUND`, `ACCOUNT_CREATE_FAILED`, `PRODUCT_NOT_FOUND`, `PRICE_NOT_FOUND`, `SUBSCRIPTION_NOT_FOUND`, `CHECKOUT_CREATE_FAILED`, `CHECKOUT_NOT_FOUND`, `PAYMENT_METHOD_FAILED`, `WEBHOOK_VERIFICATION_FAILED`, `STRIPE_API_ERROR`, `TEST_ENV_REQUIRED`, `INVALID_CONFIGURATION`.

## Resources

- [Stripe V2 Accounts API](https://docs.stripe.com/connect/accounts-v2/api)
- [Stripe Embedded Checkout](https://docs.stripe.com/payments/checkout/custom)
- [Convex Component Authoring](https://docs.convex.dev/components/authoring)
- [Stripe Webhook Event Reference](https://docs.stripe.com/api/events/types)
- [Stripe Testing Guide](https://docs.stripe.com/testing)

## License

MIT
