# BetterLearn — better-stripe Example App

> Design document for a full-featured example app showcasing the `better-stripe` Convex component.

**Date**: 2026-03-24
**Status**: Approved
**Location**: `packages/better-stripe/example/`

---

## Overview

BetterLearn is a creator academy demo app (SaaS + two-sided marketplace) that showcases every feature of the `better-stripe` component. Learners subscribe to access courses, creators earn payouts through Stripe Connect, and admins manage the platform's products and pricing.

**Key decisions:**

- **Theme**: Creator academy (mirrors Dojo's real use case, doubles as reference implementation)
- **Auth**: Mock user context with role switcher (zero setup friction — no Clerk/BetterAuth)
- **Location**: `packages/better-stripe/example/` (co-located with the component, following get-convex/stripe convention)
- **Tech**: Vite + React SPA + Convex + better-stripe component (no SSR needed — all better-stripe React is client-side)

---

## Phase 1: Project Scaffolding

### 1.1 Initialize Vite + React App

```bash
cd packages/better-stripe
npm create vite@latest example -- --template react-ts
cd example
```

### 1.2 Install Dependencies

```bash
npm install convex better-stripe @stripe/stripe-js @stripe/react-stripe-js react-router-dom
npm install -D tailwindcss @tailwindcss/vite autoprefixer
npx shadcn@latest init
npx shadcn@latest add button card tabs table badge separator skeleton input label dialog alert select
```

### 1.3 Configure Vite

```typescript
// vite.config.ts
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
```

### 1.4 Configure Convex

- Run `npx convex dev` to initialize the Convex project
- Add `better-stripe` as a workspace dependency pointing to the parent package

### 1.5 Client-Side Routing (React Router)

Since this is an SPA, use React Router for all page navigation:

```typescript
// src/main.tsx
import { BrowserRouter } from 'react-router-dom';
import { ConvexProvider, ConvexReactClient } from 'convex/react';

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <ConvexProvider client={convex}>
      <App />
    </ConvexProvider>
  </BrowserRouter>
);
```

### 1.6 Environment Variables

Create `.env.local.example` documenting required vars:

```
VITE_CONVEX_URL=             # from `npx convex dev`
STRIPE_SECRET_KEY=           # Stripe test mode secret key (Convex env var)
STRIPE_WEBHOOK_SECRET=       # from `stripe listen` (Convex env var)
VITE_STRIPE_PUBLISHABLE_KEY= # Stripe test mode publishable key
```

Note: `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are Convex environment variables (set via `npx convex env set`), not Vite env vars. Only `VITE_`-prefixed vars are exposed to the client.

---

## Phase 2: Convex Backend

### 2.1 File Structure

```
example/convex/
├── convex.config.ts        ← app.use(betterStripe)
├── schema.ts               ← courses + webhookLog tables
├── http.ts                 ← registerRoutes() for Stripe webhooks
├── stripe.ts               ← BetterStripe client + triggers/hooks config
├── courses.ts              ← Simple CRUD for demo courses
├── users.ts                ← Mock user queries (no auth)
├── webhookLog.ts           ← Queries for webhook event viewer
└── seed.ts                 ← Seed products, prices, mock users
```

### 2.2 Schema (`schema.ts`)

Minimal app-level schema (better-stripe manages its own tables internally):

```typescript
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  // Mock users (no auth — just IDs and roles)
  users: defineTable({
    name: v.string(),
    email: v.string(),
    role: v.union(
      v.literal('learner'),
      v.literal('creator'),
      v.literal('admin'),
    ),
    avatarUrl: v.optional(v.string()),
  }),

  // Simple course catalog
  courses: defineTable({
    title: v.string(),
    description: v.string(),
    creatorUserId: v.id('users'),
    imageUrl: v.optional(v.string()),
    published: v.boolean(),
  }).index('by_creator', ['creatorUserId']),

  // Course access grants (populated by subscription triggers)
  courseAccess: defineTable({
    userId: v.id('users'),
    courseId: v.id('courses'),
    grantedAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_course', ['courseId']),

  // Webhook event log for admin viewer
  webhookLog: defineTable({
    eventType: v.string(),
    stripeEventId: v.string(),
    status: v.union(
      v.literal('processed'),
      v.literal('failed'),
      v.literal('ignored'),
    ),
    payload: v.optional(v.string()),
    timestamp: v.number(),
  })
    .index('by_timestamp', ['timestamp'])
    .index('by_type', ['eventType']),
});
```

### 2.3 BetterStripe Client (`stripe.ts`)

```typescript
import { BetterStripe } from 'better-stripe';

import { components } from './_generated/api';

export const stripe = new BetterStripe(components.betterStripe, {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY!,

  triggers: {
    subscription: {
      onCreate: async (ctx, { subscription }) => {
        // Grant course access to the learner
        // (sync trigger — runs in same transaction)
      },
      onDelete: async (ctx, { subscription }) => {
        // Revoke course access
      },
    },
    checkoutSession: {
      onCompleted: async (ctx, { checkoutSession }) => {
        // Log checkout completion to webhookLog
      },
    },
  },

  hooks: {
    onPayoutCompleted: async (ctx, { payout }) => {
      // Log payout event (async — post-commit)
    },
    onInvoicePaid: async (ctx, { invoice }) => {
      // Log invoice event
    },
    onPaymentFailed: async (ctx, { payment }) => {
      // Log failed payment for admin visibility
    },
    onTrialEnding: async (ctx, { subscription }) => {
      // Log trial ending event
    },
  },
});

// Export trigger API for use in http.ts
export const {
  onCheckoutSessionCompleted,
  onSubscriptionCreated,
  onSubscriptionUpdated,
  onSubscriptionDeleted,
  onInvoicePaid,
  onPaymentFailed,
  onPayoutCompleted,
} = stripe.triggersApi();
```

### 2.4 HTTP Routes (`http.ts`)

```typescript
import { registerRoutes } from 'better-stripe';
import { httpRouter } from 'convex/server';

import { components } from './_generated/api';

const http = httpRouter();

registerRoutes(http, components.betterStripe, {
  webhookPath: '/stripe/webhook',
});

export default http;
```

### 2.5 Seed Script (`seed.ts`)

Creates:

- 3 mock users: learner, creator, admin
- 2 Stripe products: "BetterLearn Pro" (subscription), "Masterclass Bundle" (one-time)
- 3 Stripe prices: Monthly ($9/mo), Yearly ($89/yr with 7-day trial), One-time ($49)
- 3 demo courses linked to the creator user

---

## Phase 3: Mock Auth & Role Switcher

### 3.1 RoleContext Provider

A React context that holds the current mock user and exposes a role switcher:

```typescript
// src/providers/role-context.tsx
type Role = 'learner' | 'creator' | 'admin';

interface MockUser {
  id: string; // Convex user ID
  name: string;
  email: string;
  role: Role;
}

// Provider stores current role in state
// Exposes: currentUser, currentRole, setRole
```

### 3.2 Role Switcher Component

A segmented control in the app header:

```
[👤 Learner]  [🎨 Creator]  [⚙️ Admin]
```

Switching roles:

- Swaps the active mock user ID
- Shows/hides role-specific nav items
- Persists selection in localStorage

### 3.3 Navigation

Sidebar/header navigation changes per role:

| Learner         | Creator    | Admin         |
| --------------- | ---------- | ------------- |
| Dashboard       | Earnings   | Overview      |
| Billing         | Onboarding | Products      |
| Invoices        | Payouts    | Subscriptions |
| Payment Methods | Account    | Webhooks      |

---

### 3.4 SPA Route Structure (React Router)

```typescript
// src/App.tsx — route definitions
<Routes>
  <Route element={<AppShell />}>         {/* Layout: header + role switcher + sidebar */}
    <Route path="/" element={<Landing />} />
    <Route path="/checkout" element={<Checkout />} />
    <Route path="/checkout/status" element={<CheckoutStatusPage />} />

    {/* Learner routes */}
    <Route path="/dashboard" element={<Dashboard />} />
    <Route path="/dashboard/billing" element={<Billing />} />
    <Route path="/dashboard/invoices" element={<Invoices />} />
    <Route path="/dashboard/payment-methods" element={<PaymentMethods />} />

    {/* Creator routes */}
    <Route path="/creator" element={<CreatorHome />} />
    <Route path="/creator/onboarding" element={<Onboarding />} />
    <Route path="/creator/payouts" element={<Payouts />} />
    <Route path="/creator/account" element={<CreatorAccount />} />

    {/* Admin routes */}
    <Route path="/admin" element={<AdminOverview />} />
    <Route path="/admin/products" element={<AdminProducts />} />
    <Route path="/admin/subscriptions" element={<AdminSubscriptions />} />
    <Route path="/admin/webhooks" element={<AdminWebhooks />} />
    <Route path="/admin/testing" element={<AdminTesting />} />
  </Route>
</Routes>
```

### 3.5 File Structure (src/)

```
src/
├── main.tsx                    ← Entry: BrowserRouter + ConvexProvider
├── App.tsx                     ← Routes + StripeProvider
├── components/
│   ├── ui/                     ← shadcn/ui components
│   ├── app-shell.tsx           ← Layout: header + sidebar + <Outlet />
│   ├── role-switcher.tsx       ← Segmented control
│   └── nav-sidebar.tsx         ← Role-aware navigation
├── pages/
│   ├── landing.tsx
│   ├── checkout.tsx
│   ├── checkout-status.tsx
│   ├── dashboard/
│   │   ├── index.tsx
│   │   ├── billing.tsx
│   │   ├── invoices.tsx
│   │   └── payment-methods.tsx
│   ├── creator/
│   │   ├── index.tsx
│   │   ├── onboarding.tsx
│   │   ├── payouts.tsx
│   │   └── account.tsx
│   └── admin/
│       ├── index.tsx
│       ├── products.tsx
│       ├── subscriptions.tsx
│       ├── webhooks.tsx
│       └── testing.tsx
├── providers/
│   └── role-context.tsx
└── lib/
    └── utils.ts                ← cn() utility
```

---

## Phase 4: Frontend — Landing & Checkout

### 4.1 Landing Page (`/`)

**Components used**: `PricePicker`, `IntervalSelector`, `PriceCard`, `PriceBadge`

Layout:

- Hero section: "Learn from the best creators"
- Pricing section: PricePicker with monthly/yearly toggle
  - Pro Monthly card ($9/mo)
  - Pro Yearly card ($89/yr, "7-day free trial" badge)
  - Masterclass Bundle card ($49 one-time)
- Each PriceCard has a "Get Started" button → navigates to `/checkout?priceId=xxx`

### 4.2 Checkout Page (`/checkout`)

**Components used**: `CheckoutSessionProvider`, `EmbeddedCheckout`

- Reads `priceId` from query params
- Creates a checkout session via Convex action (`stripe.createCheckoutSession()`)
- Renders `EmbeddedCheckout` with the session
- Success URL → `/checkout/status?session_id={CHECKOUT_SESSION_ID}`

### 4.3 Checkout Status Page (`/checkout/status`)

**Components used**: `CheckoutStatus`

- Reads `session_id` from query params
- Shows success/failure state
- Links to dashboard on success

---

## Phase 5: Frontend — Learner Dashboard

### 5.1 Dashboard Home (`/dashboard`)

**Hooks used**: `createUseSubscription`, `createUseAccount`

- Shows current subscription status via `SubscriptionCard`
- Lists enrolled courses (from `courseAccess` table)
- If no subscription: CTA to pricing page

### 5.2 Billing Page (`/dashboard/billing`)

**Components used**: `SubscriptionCard`, `SubscriptionLineItems`, `TrialAlert`, `BillingPortalLink`

Layout:

- `TrialAlert` at top (if in trial period)
- `SubscriptionCard` showing current plan
- `SubscriptionLineItems` showing charge breakdown
- `BillingPortalLink` button → opens Stripe's hosted portal
- Cancel / Reactivate subscription buttons (using `stripe.cancelSubscription()` / `stripe.reactivateSubscription()`)

### 5.3 Invoices Page (`/dashboard/invoices`)

**Hooks used**: `createUseInvoices`

- Table listing all invoices with: date, amount, status, PDF link
- Uses `stripe.listInvoices()` data

### 5.4 Payment Methods Page (`/dashboard/payment-methods`)

**Components used**: `AddCardForm`, `PaymentMethodsList`, `DeletePaymentMethodDialog`

**Hooks used**: `createUsePaymentMethods`, `usePaymentMethodActions`

Layout:

- `PaymentMethodsList` showing saved cards
- `AddCardForm` to add a new card
- Each card has a delete button → `DeletePaymentMethodDialog`

---

## Phase 6: Frontend — Creator Dashboard

### 6.1 Creator Home (`/creator`)

**Hooks used**: `createUseAccount`, `createUseAccountOnboarding`

- Earnings overview (total payouts, pending balance)
- Recent payout summary
- If no Connect account: shows `AccountCreateCard`
- If account exists but not onboarded: shows `ConnectStatusBadge` with pending status

### 6.2 Onboarding Page (`/creator/onboarding`)

**Components used**: `AccountOnboardingCard`, `ConnectStatusBadge`, `ConnectRequirements`

- Step-by-step Connect onboarding flow
- `ConnectRequirements` shows what's missing (identity, bank account, etc.)
- `ConnectStatusBadge` shows current onboarding status
- Uses `stripe.createAccountLink()` and `stripe.getAccountOnboardingStatus()`

### 6.3 Payouts Page (`/creator/payouts`)

**Hooks used**: (direct queries to `stripe.listPayouts()`)

- Table of all payouts: date, amount, status, arrival date
- Uses `stripe.listPayouts()` data

### 6.4 Account Page (`/creator/account`)

**Components used**: `AccountLoginCard`, `ConnectRequirements`

- `AccountLoginCard` — link to Stripe Express dashboard
- Account details (country, email, status)
- `ConnectRequirements` if anything still needs attention

---

## Phase 7: Frontend — Admin Dashboard

### 7.1 Admin Overview (`/admin`)

**Hooks used**: `useStripeMode`, `createUseSubscriptions`, `createUseProducts`

- Stripe mode indicator (test/live) via `useStripeMode()`
- Key metrics: total subscriptions, active subscriptions, total products
- Quick links to sub-pages

### 7.2 Products & Prices (`/admin/products`)

**Hooks used**: `createUseProducts`, `createUsePrices`

Full CRUD interface demonstrating:

- `stripe.createProduct()` — create a new product
- `stripe.updateProduct()` — edit name/description
- `stripe.deactivateProduct()` — archive a product
- `stripe.createPrice()` — add pricing to a product
- `stripe.deactivatePrice()` — archive a price
- Table view with expandable rows showing prices per product

### 7.3 Subscriptions (`/admin/subscriptions`)

**Hooks used**: `createUseSubscriptions`

- Table of all platform subscriptions
- Filters: active, trialing, past_due, canceled
- Shows: user, plan, status, current period, trial end date
- Uses `stripe.listSubscriptions()` with status filter

### 7.4 Webhook Event Log (`/admin/webhooks`)

- Table reading from the `webhookLog` table (populated by triggers/hooks)
- Columns: timestamp, event type, status (processed/failed/ignored), Stripe event ID
- Expandable rows showing raw payload JSON
- Demonstrates the ledger-based deduplication and replay protection
- Filter by event type and status

---

## Phase 8: Testing Utilities Showcase

Include a `/admin/testing` page (dev-only) that demonstrates `better-stripe/testing` exports:

- `assertTestEnvironment()` — shows test mode guard
- Buttons to fire mock webhook events:
  - `mockCheckoutCompleted()` → appears in webhook log
  - `mockSubscriptionUpdated()` → updates subscription state
  - `mockAccountUpdated()` → updates creator account
  - `mockInvoicePaid()` → appears in invoice list
- Uses `createTestAccount()`, `createTestProduct()`, `createTestPrice()`, `createTestSubscription()` to populate fixture data

---

## Component Coverage Matrix

| Component                   | Page                                      | Section |
| --------------------------- | ----------------------------------------- | ------- |
| `StripeProvider`            | `App.tsx` (root)                          | Phase 3 |
| `PricePicker`               | `/`                                       | Phase 4 |
| `IntervalSelector`          | `/`                                       | Phase 4 |
| `PriceCard`                 | `/`                                       | Phase 4 |
| `PriceBadge`                | `/`                                       | Phase 4 |
| `CheckoutSessionProvider`   | `/checkout`                               | Phase 4 |
| `EmbeddedCheckout`          | `/checkout`                               | Phase 4 |
| `CheckoutStatus`            | `/checkout/status`                        | Phase 4 |
| `SubscriptionCard`          | `/dashboard/billing`                      | Phase 5 |
| `SubscriptionLineItems`     | `/dashboard/billing`                      | Phase 5 |
| `TrialAlert`                | `/dashboard/billing`                      | Phase 5 |
| `BillingPortalLink`         | `/dashboard/billing`                      | Phase 5 |
| `AddCardForm`               | `/dashboard/payment-methods`              | Phase 5 |
| `PaymentMethodsList`        | `/dashboard/payment-methods`              | Phase 5 |
| `DeletePaymentMethodDialog` | `/dashboard/payment-methods`              | Phase 5 |
| `AccountOnboardingCard`     | `/creator/onboarding`                     | Phase 6 |
| `AccountCreateCard`         | `/creator`                                | Phase 6 |
| `AccountLoginCard`          | `/creator/account`                        | Phase 6 |
| `ConnectStatusBadge`        | `/creator/onboarding`                     | Phase 6 |
| `ConnectRequirements`       | `/creator/onboarding`, `/creator/account` | Phase 6 |

## Hook Coverage Matrix

| Hook                         | Page                    | Section    |
| ---------------------------- | ----------------------- | ---------- |
| `createUseAccount`           | Creator dashboard       | Phase 6    |
| `createUseProducts`          | Landing, Admin products | Phase 4, 7 |
| `createUsePrices`            | Landing, Admin products | Phase 4, 7 |
| `createUseSubscription`      | Dashboard billing       | Phase 5    |
| `createUseSubscriptions`     | Admin subscriptions     | Phase 7    |
| `createUseCheckout`          | Checkout flow           | Phase 4    |
| `createUsePaymentMethods`    | Payment methods         | Phase 5    |
| `createUseInvoices`          | Invoices page           | Phase 5    |
| `createUseAccountOnboarding` | Creator onboarding      | Phase 6    |
| `useStripePublishableKey`    | `App.tsx` (provider)    | Phase 3    |
| `useStripeMode`              | Admin dashboard         | Phase 7    |
| `useStripeConfig`            | `App.tsx` (provider)    | Phase 3    |
| `useCheckoutSession`         | Checkout flow           | Phase 4    |
| `useConfirmPayment`          | Checkout flow           | Phase 4    |
| `usePaymentMethodActions`    | Payment methods         | Phase 5    |

## BetterStripe Client Method Coverage

| Method Category     | Methods Demonstrated                                                                                                                                         | Where                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| **Accounts**        | `createAccount`, `getAccount`, `getOrCreateAccount`, `getAccountByUserId`, `getAccountOnboardingStatus`, `updateAccount`                                     | Creator pages                |
| **Products**        | `createProduct`, `listProducts`, `updateProduct`, `deactivateProduct`                                                                                        | Admin products               |
| **Prices**          | `createPrice`, `listPrices`, `listPricesByProduct`, `updatePrice`, `deactivatePrice`                                                                         | Admin products, Landing      |
| **Checkout**        | `createCheckoutSession`, `getCheckoutSession`                                                                                                                | Checkout flow                |
| **Subscriptions**   | `getSubscription`, `listSubscriptions`, `listSubscriptionsByUser`, `getActiveSubscription`, `cancelSubscription`, `reactivateSubscription`, `getTrialStatus` | Dashboard billing, Admin     |
| **Invoices**        | `listInvoices`                                                                                                                                               | Invoices page                |
| **Payment Methods** | `listPaymentMethods`, `attachPaymentMethod`, `detachPaymentMethod`                                                                                           | Payment methods page         |
| **Payouts**         | `listPayouts`                                                                                                                                                | Creator payouts              |
| **Account Links**   | `createAccountLink`, `createLoginLink`, `getAccountLinkWithStatus`                                                                                           | Creator onboarding/account   |
| **Billing Portal**  | `createBillingPortalSession`                                                                                                                                 | Dashboard billing            |
| **Config**          | `getPublishableKey`, `getStripeMode`                                                                                                                         | App root, Admin              |
| **Sync**            | `syncAllAccounts`, `syncAllProducts`, `syncAllSubscriptions`                                                                                                 | Admin (optional sync button) |

## Trigger & Hook Coverage

| Type             | Trigger/Hook                  | Demonstrated Behavior |
| ---------------- | ----------------------------- | --------------------- |
| **Sync Trigger** | `subscription.onCreate`       | Grant course access   |
| **Sync Trigger** | `subscription.onDelete`       | Revoke course access  |
| **Sync Trigger** | `checkoutSession.onCompleted` | Log to webhookLog     |
| **Async Hook**   | `onPayoutCompleted`           | Log to webhookLog     |
| **Async Hook**   | `onInvoicePaid`               | Log to webhookLog     |
| **Async Hook**   | `onPaymentFailed`             | Log to webhookLog     |
| **Async Hook**   | `onTrialEnding`               | Log to webhookLog     |

---

## Implementation Order

1. **Phase 1** — Scaffold Vite + React app, install deps, configure Convex + React Router
2. **Phase 2** — Convex backend: schema, stripe client, http routes, seed script
3. **Phase 3** — Mock auth: role context, role switcher, navigation shell
4. **Phase 4** — Landing page + checkout flow (first end-to-end Stripe interaction)
5. **Phase 5** — Learner dashboard (subscription, billing, invoices, payment methods)
6. **Phase 6** — Creator dashboard (Connect onboarding, payouts, account)
7. **Phase 7** — Admin dashboard (products CRUD, subscriptions list, webhook log)
8. **Phase 8** — Testing utilities showcase page

---

## Getting Started (README outline)

```markdown
# BetterLearn — better-stripe Example App

A Vite + React SPA showcasing every feature of the `better-stripe` Convex component.

## Quick Start

1. Install:
   cd packages/better-stripe/example && npm install

2. Set up Convex:
   npx convex dev

3. Set Stripe env vars (Convex dashboard or CLI):
   npx convex env set STRIPE*SECRET_KEY sk_test*...
   npx convex env set STRIPE*WEBHOOK_SECRET whsec*...

4. Set client env vars:
   cp .env.local.example .env.local

   # Edit .env.local with your VITE_CONVEX_URL and VITE_STRIPE_PUBLISHABLE_KEY

5. Seed demo data:
   npx convex run seed

6. Start dev server:
   npm run dev

7. Start Stripe webhook listener:
   stripe listen --forward-to <your-convex-http-url>/stripe/webhook

8. Open http://localhost:5173 and switch between roles to explore!

## Roles

- **Learner**: Subscribe, manage billing, view invoices
- **Creator**: Connect onboarding, view payouts & earnings
- **Admin**: Manage products/prices, view all subscriptions, webhook log

## Tech Stack

- Vite + React 19 + TypeScript
- Convex (backend + real-time subscriptions)
- better-stripe (Stripe V2 Accounts component)
- React Router (client-side routing)
- Tailwind CSS + shadcn/ui
```
