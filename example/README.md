# BetterLearn — better-stripe Example App

A Vite + React SPA showcasing every feature of the `better-stripe` Convex component.
All data comes from Stripe via better-stripe — no mock data.

## Quick Start

```bash
cd packages/better-stripe/example
npm install
```

**One command sets everything up:**

```bash
npm run setup
```

This will:

1. Set `STRIPE_SECRET_KEY` in Convex environment
2. Create a Stripe webhook endpoint with all 19 required events
3. Set `STRIPE_WEBHOOK_SECRET` in Convex environment
4. Seed demo data (users, courses, Stripe products & prices)

**Start the app:**

```bash
npm run dev
```

Open **http://localhost:5173** and switch between roles to explore.

### Reset & Re-seed

```bash
npx convex run reset:run   # Clear all data (app DB + better-stripe component DB)
npm run setup               # Re-seed everything
```

### Prerequisites

- Node.js 18+
- A Stripe account with a test-mode secret key
- Copy `.env.local.example` to `.env.local` and fill in your keys:
  ```
  VITE_CONVEX_URL=             # from `npx convex dev`
  VITE_STRIPE_PUBLISHABLE_KEY= # pk_test_...
  STRIPE_SECRET_KEY=           # sk_test_... (used by setup script)
  VITE_CONVEX_SITE_URL=        # https://your-deployment.convex.site
  ```

## Architecture

All Stripe data flows through the `better-stripe` Convex component.
The app never calls the Stripe SDK directly — it uses:

- **`convex/stripe.ts`** — `BetterStripe` client instance with triggers and hooks
- **`convex/queries.ts`** — Query wrappers exposing component data to the frontend
- **`convex/actions.ts`** — Action wrappers for Stripe API calls (checkout, accounts, payment methods)
- **`convex/http.ts`** — Webhook endpoint via `registerRoutes()`

## Roles

Use the role switcher in the header to explore different perspectives:

- **Learner** — Subscribe to plans, manage billing & payment methods, view invoices
- **Creator** — Connect onboarding, view payouts & earnings, manage Stripe account
- **Admin** — Manage products/prices, view all subscriptions, webhook event log

## What's Demonstrated

### BetterStripe Client Methods

| Method                                  | Used In                               |
| --------------------------------------- | ------------------------------------- |
| `stripe.listProducts()`                 | queries.ts, admin/products            |
| `stripe.listPricesByProduct()`          | queries.ts                            |
| `stripe.createProduct()`                | actions.ts, admin/products            |
| `stripe.createPrice()`                  | actions.ts, admin/products            |
| `stripe.listSubscriptions()`            | queries.ts, admin/subscriptions       |
| `stripe.listSubscriptionsByUser()`      | queries.ts, dashboard/billing         |
| `stripe.cancelSubscription()`           | actions.ts, dashboard/billing         |
| `stripe.listInvoices()`                 | queries.ts, dashboard/invoices        |
| `stripe.listPayouts()`                  | queries.ts, creator/payouts           |
| `stripe.createAccountWithOnboarding()`  | actions.ts, creator/onboarding        |
| `stripe.getAccountByUserId()`           | queries.ts, creator/account           |
| `stripe.getAccountLinkWithStatus()`     | actions.ts, creator/onboarding        |
| `stripe.createCheckoutSession()`        | actions.ts, checkout                  |
| `stripe.getCheckoutSessionByStripeId()` | queries.ts, checkout-status           |
| `stripe.listPaymentMethods()`           | actions.ts, dashboard/payment-methods |
| `stripe.attachPaymentMethod()`          | actions.ts, dashboard/payment-methods |
| `stripe.detachPaymentMethod()`          | actions.ts, dashboard/payment-methods |
| `stripe.getPublishableKey()`            | queries.ts                            |
| `stripe.getStripeMode()`                | queries.ts                            |
| `stripe.listWebhookEndpoints()`         | setup.ts                              |
| `stripe.createWebhookEndpoint()`        | setup.ts                              |
| `stripe.clearAll()`                     | reset.ts                              |

### Connect Onboarding (V2 Accounts)

The creator onboarding flow demonstrates `createAccountWithOnboarding()`:

```ts
// Default: merchant configuration with card_payments
const result = await stripe.createAccountWithOnboarding(ctx, {
  userId: 'user_123',
  email: 'creator@example.com',
  refreshUrl: 'https://yourapp.com/onboarding',
  returnUrl: 'https://yourapp.com/onboarding',
});
// result.onboardingUrl → redirect user to Stripe hosted onboarding

// Override: recipient only (for payouts)
await stripe.createAccountWithOnboarding(ctx, {
  ...baseOpts,
  accountConfiguration: {
    recipient: {
      capabilities: {
        stripe_balance: { stripe_transfers: { requested: true } },
      },
    },
  },
});

// Override: merchant + recipient (full platform)
await stripe.createAccountWithOnboarding(ctx, {
  ...baseOpts,
  accountConfiguration: {
    merchant: {
      capabilities: { card_payments: { requested: true } },
    },
    recipient: {
      capabilities: {
        stripe_balance: { stripe_transfers: { requested: true } },
      },
    },
  },
  dashboard: 'full', // or 'express' (default)
});
```

Default configuration is exposed as `BetterStripe.DEFAULT_ACCOUNT_CONFIGURATION`.

### React Components (from `better-stripe/react`)

| Component                                   | Page                       |
| ------------------------------------------- | -------------------------- |
| `StripeProviderWithKey`                     | Payment methods            |
| `PriceBadge`, `IntervalSelector`            | Landing                    |
| `EmbeddedCheckout`                          | Checkout                   |
| `CheckoutStatus`                            | Checkout status            |
| `AddCardForm`, `PaymentMethodsList`         | Payment methods            |
| `usePaymentMethodActions`                   | Payment methods            |
| `AccountOnboardingCard`                     | Creator onboarding         |
| `ConnectStatusBadge`, `ConnectRequirements` | Creator onboarding/account |
| `formatPrice`, `formatPriceWithInterval`    | Various                    |

### React Hooks (from `better-stripe/react`)

| Hook                      | Purpose                             |
| ------------------------- | ----------------------------------- |
| `useStripePublishableKey` | Load publishable key from Convex    |
| `useStripeMode`           | Detect test/live mode               |
| `useStripeConfig`         | Combined key + mode + loading state |
| `useCheckoutSession`      | Checkout session state              |
| `useConfirmPayment`       | Payment confirmation                |
| `usePaymentMethodActions` | Payment method CRUD                 |

### Sync Triggers & Async Hooks

| Type         | Handler                       | What it does          |
| ------------ | ----------------------------- | --------------------- |
| Sync Trigger | `subscription.onCreate`       | Grants course access  |
| Sync Trigger | `subscription.onDelete`       | Revokes course access |
| Sync Trigger | `checkoutSession.onCompleted` | Logs to webhook log   |
| Async Hook   | `onPayoutCompleted`           | Logs payout event     |
| Async Hook   | `onInvoicePaid`               | Logs invoice event    |
| Async Hook   | `onPaymentFailed`             | Logs failed payment   |
| Async Hook   | `onTrialEnding`               | Logs trial ending     |

### Setup Script (`npm run setup`)

The setup script demonstrates:

- `stripe.createWebhookEndpoint()` — create/replace webhook endpoints programmatically
- `stripe.listWebhookEndpoints()` — check for existing endpoints
- `stripe.createProduct()` / `stripe.createPrice()` — seed Stripe catalog
- `stripe.listProducts()` — idempotency check before seeding
- `stripe.clearAll()` — wipe component DB for reset

### Webhook Processing

`registerRoutes()` in `http.ts` handles 19 Stripe event types:

- Products: `product.created`, `product.updated`
- Prices: `price.created`, `price.updated`
- Subscriptions: `customer.subscription.created/updated/deleted`
- Checkout: `checkout.session.completed`
- Invoices: `invoice.created/finalized/paid/payment_failed`
- Payments: `payment_intent.succeeded/payment_failed/canceled`
- Payouts: `payout.created/updated/paid/failed`

All events are synced to the component DB and available via reactive Convex queries.

## Tech Stack

- **Vite** + **React 19** + **TypeScript**
- **Convex** (backend + real-time subscriptions)
- **better-stripe** (Stripe V2 Accounts component)
- **shadcn/ui** + **Tailwind CSS v4** (UI components)
- **React Router** (client-side routing)
- **lucide-react** (icons)

## Project Structure

```
example/
├── convex/
│   ├── convex.config.ts        # app.use(betterStripe)
│   ├── schema.ts               # users, courses, courseAccess, webhookLog
│   ├── http.ts                 # registerRoutes() webhook endpoint
│   ├── stripe.ts               # BetterStripe client + triggers + hooks
│   ├── queries.ts              # Query wrappers for component data
│   ├── actions.ts              # Action wrappers for Stripe API calls
│   ├── setup.ts                # ensureWebhook action (used by setup script)
│   ├── seed.ts                 # Seed DB + Stripe products
│   ├── reset.ts                # Clear all data
│   ├── courses.ts              # Course CRUD + access grants
│   ├── users.ts                # User queries
│   └── webhookLog.ts           # Webhook event log
├── scripts/
│   └── setup.ts                # One-command setup script
├── src/
│   ├── main.tsx                # BrowserRouter + ConvexProvider
│   ├── App.tsx                 # Routes
│   ├── components/ui/          # shadcn/ui components
│   ├── components/
│   │   ├── app-shell.tsx       # Layout: header + sidebar
│   │   ├── role-switcher.tsx   # Role toggle
│   │   └── nav-sidebar.tsx     # Role-aware navigation
│   ├── pages/
│   │   ├── landing.tsx         # Pricing (real products from Stripe)
│   │   ├── checkout.tsx        # EmbeddedCheckout
│   │   ├── checkout-status.tsx # CheckoutStatus
│   │   ├── dashboard/          # Learner: billing, invoices, payment methods
│   │   ├── creator/            # Creator: onboarding, account, payouts
│   │   └── admin/              # Admin: products, subscriptions, webhooks
│   ├── providers/
│   │   └── role-context.tsx    # Demo role switcher (mock auth)
│   └── lib/
│       └── utils.ts            # cn() utility
├── .env.local.example
└── package.json
```

## Scripts

| Command                    | Description                                    |
| -------------------------- | ---------------------------------------------- |
| `npm run setup`            | Set Convex env vars, create webhook, seed data |
| `npm run dev`              | Start Vite + Convex dev in parallel            |
| `npm run typecheck`        | TypeScript check (frontend)                    |
| `npm run typecheck:convex` | TypeScript check (Convex functions)            |
| `npm run lint`             | ESLint                                         |
| `npm run build`            | Production build                               |
| `npx convex run reset:run` | Clear all data                                 |
