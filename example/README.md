# better-stripe Example -- T-Shirt Shop

A Vite + React SPA showcasing every feature of the `better-stripe` Convex component.
All data comes from Stripe via better-stripe -- no mock data.

## Quick Start

```bash
cd packages/better-stripe/example
npm install
```

**Set the Stripe secret key:**

```bash
npm run setup
```

This reads `STRIPE_SECRET_KEY` from `.env.local` and sets it as a Convex environment variable. That's all the CLI setup does.

**Start the app:**

```bash
npm run dev
```

Open **http://localhost:5173** and go to **/admin/setup** to finish setup:

1. Set up webhook event destinations (V1 snapshot + V2 thin)
2. Seed demo data (users + Stripe products/prices)
3. Sync existing Stripe data (products, subscriptions, accounts)

### Reset & Re-seed

```bash
npx convex run reset:run   # Clear all data (app DB + better-stripe component DB)
npm run setup               # Re-set the Stripe key
```

Then visit `/admin/setup` again to re-seed and re-sync.

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
The app never calls the Stripe SDK directly -- it uses:

- **`convex/stripe.ts`** -- `BetterStripe` client instance with triggers and hooks
- **`convex/queries.ts`** -- Query wrappers exposing component data to the frontend
- **`convex/actions.ts`** -- Action wrappers for Stripe API calls (checkout, accounts, webhooks, payment methods)
- **`convex/http.ts`** -- Webhook endpoint via `registerRoutes()` with dual webhook secrets (V1 + V2)

## Roles

Use the role switcher in the header to explore different perspectives:

- **Customer** -- Browse products, subscribe, manage billing & payment methods, view invoices
- **Seller** -- Connect onboarding, view payouts & earnings, manage Stripe account
- **Admin** -- Manage products/prices, view subscriptions, webhook event log, setup

## What's Demonstrated

### BetterStripe Client Methods

| Method                                  | Used In                               |
| --------------------------------------- | ------------------------------------- |
| `stripe.listProducts()`                 | queries.ts, admin/products            |
| `stripe.listPricesByProduct()`          | queries.ts                            |
| `stripe.listPrices()`                   | queries.ts                            |
| `stripe.createProduct()`                | actions.ts, admin/products            |
| `stripe.createPrice()`                  | actions.ts, admin/products            |
| `stripe.listSubscriptions()`            | queries.ts, admin/subscriptions       |
| `stripe.listSubscriptionsByUser()`      | queries.ts, dashboard/billing         |
| `stripe.cancelSubscription()`           | actions.ts, dashboard/billing         |
| `stripe.listInvoices()`                 | queries.ts, dashboard/invoices        |
| `stripe.listPayouts()`                  | queries.ts, seller/payouts            |
| `stripe.createAccountWithOnboarding()`  | actions.ts, seller/onboarding         |
| `stripe.restartAccountOnboarding()`     | actions.ts, seller/onboarding         |
| `stripe.getAccountByUserId()`           | queries.ts, seller/account            |
| `stripe.getAccountLinkWithStatus()`     | actions.ts, seller/onboarding         |
| `stripe.createCheckoutSession()`        | actions.ts, checkout                  |
| `stripe.getCheckoutSessionByStripeId()` | queries.ts, checkout-status           |
| `stripe.listPaymentMethods()`           | actions.ts, dashboard/payment-methods |
| `stripe.attachPaymentMethod()`          | actions.ts, dashboard/payment-methods |
| `stripe.detachPaymentMethod()`          | actions.ts, dashboard/payment-methods |
| `stripe.getPublishableKey()`            | queries.ts                            |
| `stripe.getStripeMode()`                | queries.ts                            |
| `stripe.setupEventDestination()`        | actions.ts, admin/setup               |
| `stripe.listEventDestinations()`        | actions.ts, admin/setup               |
| `stripe.listWebhookEvents()`            | queries.ts, admin/webhooks            |
| `stripe.syncAllProducts()`              | actions.ts, admin/setup               |
| `stripe.syncAllSubscriptions()`         | actions.ts, admin/setup               |
| `stripe.syncAllAccounts()`              | actions.ts, admin/setup               |
| `stripe.clearAll()`                     | reset.ts                              |

### Connect Onboarding (V2 Accounts)

The seller onboarding flow demonstrates `createAccountWithOnboarding()`:

```ts
// Default: merchant configuration with card_payments
const result = await stripe.createAccountWithOnboarding(ctx, {
  userId: "user_123",
  email: "seller@example.com",
  refreshUrl: "https://yourapp.com/onboarding",
  returnUrl: "https://yourapp.com/onboarding",
});
// result.onboardingUrl -> redirect user to Stripe hosted onboarding

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
  dashboard: "full", // or 'express' (default)
});
```

Default configuration is exposed as `BetterStripe.DEFAULT_ACCOUNT_CONFIGURATION`.

### React Components (from `better-stripe/react`)

| Component                                   | Page                      |
| ------------------------------------------- | ------------------------- |
| `StripeProviderWithKey`                     | Payment methods           |
| `PriceBadge`, `IntervalSelector`            | Landing                   |
| `EmbeddedCheckout`                          | Checkout                  |
| `CheckoutStatus`                            | Checkout status           |
| `AddCardForm`, `PaymentMethodsList`         | Payment methods           |
| `usePaymentMethodActions`                   | Payment methods           |
| `AccountOnboardingCard`                     | Seller onboarding         |
| `AccountCloseButton`, `AccountCloseCard`    | Seller account            |
| `AccountCreateButton`                       | Seller onboarding         |
| `AccountLoginButton`                        | Seller account            |
| `AccountOnboardingButton`                   | Seller onboarding         |
| `ConnectStatusBadge`, `ConnectRequirements` | Seller onboarding/account |
| `SubscriptionActions`                       | Dashboard billing         |
| `PaymentMethodActions`                      | Dashboard payment methods |
| `formatPrice`, `formatPriceWithInterval`    | Various                   |

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

| Type         | Handler                       | What it does               |
| ------------ | ----------------------------- | -------------------------- |
| Sync Trigger | `subscription.onCreate`       | Logs subscription creation |
| Sync Trigger | `subscription.onDelete`       | Logs subscription deletion |
| Sync Trigger | `checkoutSession.onCompleted` | Logs checkout completion   |
| Async Hook   | `onPayoutCompleted`           | Logs payout event          |
| Async Hook   | `onInvoicePaid`               | Logs invoice event         |
| Async Hook   | `onPaymentFailed`             | Logs failed payment        |
| Async Hook   | `onTrialEnding`               | Logs trial ending          |

### Setup Script (`npm run setup`)

The setup script only sets `STRIPE_SECRET_KEY` in the Convex environment. All other setup (webhooks, seeding, syncing) is done through the Admin UI at `/admin/setup`.

### Webhook Processing

`registerRoutes()` in `http.ts` handles 31 Stripe events across two webhook types:

**V1 Snapshot Events (19):**

- Products: `product.created`, `product.updated`
- Prices: `price.created`, `price.updated`
- Subscriptions: `customer.subscription.created/updated/deleted`
- Checkout: `checkout.session.completed`
- Invoices: `invoice.created/finalized/paid/payment_failed`
- Payments: `payment_intent.succeeded/payment_failed/canceled`
- Payouts: `payout.created/updated/paid/failed`

**V2 Thin Events (12):**

- Account lifecycle: `v2.core.account.*` events (created, updated, closed, etc.)

The webhook endpoint accepts both V1 and V2 event payloads, verified with separate secrets (`STRIPE_WEBHOOK_SECRET` for V1, `STRIPE_WEBHOOK_SECRET_V2` for V2). All events are stored in the component's `webhookEvents` table and viewable in the admin webhook log.

### Seed Data

The setup flow creates:

- **Users**: Alex Customer, Jordan Seller, Sam Admin
- **Products**:
  - Classic Tee -- $29 one-time purchase
  - Tee of the Month Club -- $19/mo or $189/yr subscription

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
│   ├── schema.ts               # users table only
│   ├── http.ts                 # registerRoutes() webhook endpoint (V1 + V2)
│   ├── stripe.ts               # BetterStripe client + triggers + hooks
│   ├── queries.ts              # Query wrappers for component data
│   ├── actions.ts              # Action wrappers for Stripe API calls + admin setup
│   ├── setup.ts                # ensureWebhook action (legacy, used by setup script)
│   ├── seed.ts                 # Seed DB + Stripe products
│   ├── reset.ts                # Clear all data
│   └── users.ts                # User queries
├── scripts/
│   └── setup.ts                # Sets STRIPE_SECRET_KEY in Convex env
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
│   │   ├── dashboard/          # Customer: billing, invoices, payment methods
│   │   ├── seller/             # Seller: onboarding, account, payouts, products
│   │   └── admin/              # Admin: products, subscriptions, webhooks, setup
│   ├── providers/
│   │   └── role-context.tsx    # Demo role switcher (mock auth)
│   └── lib/
│       └── utils.ts            # cn() utility
├── .env.local.example
└── package.json
```

## Scripts

| Command                    | Description                                 |
| -------------------------- | ------------------------------------------- |
| `npm run setup`            | Set STRIPE_SECRET_KEY in Convex environment |
| `npm run dev`              | Start Vite + Convex dev in parallel         |
| `npm run typecheck`        | TypeScript check (frontend)                 |
| `npm run typecheck:convex` | TypeScript check (Convex functions)         |
| `npm run lint`             | ESLint                                      |
| `npm run build`            | Production build                            |
| `npx convex run reset:run` | Clear all data                              |
