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

The seed is **idempotent and resumable**: every step guards on what already
exists (users by email, accounts by their linked `stripeAccountId`, catalogs by
store-tagged products), so re-running `seed:run` — with or without a prior
reset — never duplicates data and backfills only whatever is missing (e.g.
after a partial failure).

### Marketplace scenario

Beyond the classic demo personas, the seed creates a real marketplace
(Skool-style) scenario:

- **Sellers** (`Maya Merchant`, `Sasha Studio`) -- V2 accounts carrying BOTH the
  `recipient` configuration (they receive transfers) and the `customer`
  configuration (they can be billed platform fees) on one account. In test
  mode their `stripe_balance.stripe_transfers` capability is activated
  entirely via API (test SSN + ToS attestation + business URL), so seeded
  transfers succeed without hosted onboarding.
- **Platform catalog** -- each store's products/prices are created on the
  PLATFORM Stripe account and tagged to the store via the component's
  `accountId` field plus `storeAccountId`/`storeName` metadata
  (`stripe.listProducts({ accountId })` lists one store's catalog).
- **Platform fee tiers** -- `convex/stripe.ts` configures the platform's take
  as a tiered `platformFee` (2.9% + 30¢ up to $899, 3.9% + 30¢ above), applied
  whenever a sale routes funds to a seller.
- **Affiliate** (`Avery Affiliate`) -- a recipient-only account, activated the
  same way, for referral-share transfers in split sales.
- **Buyer** (`Billie Buyer`) -- a billable `customer_account` with a reusable
  test card (`pm_card_visa`) attached, so purchases can charge off-session.

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

The marketplace account demo (BTS-46, `/seller/marketplace-account`) is the
end-to-end version of the `recipient`-only override above: onboard as a
recipient via hosted Express, then `addCustomerConfiguration()` to make the
SAME account billable, then pass that `stripeAccountId` as `accountId` on
`createCheckoutSession()` (→ `customer_account`) so the account can buy
something as a customer. `addRecipientConfiguration()` and a direct
`updateV2Account({ configuration: { merchant: {...} } })` call demonstrate
adding configurations later, after the account already exists — see
[Manual QA](#browser-e2e-tests-npm-run-e2e) above.

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

Every trigger and hook also records a row in the app's `triggerLog` table (`convex/triggerLogger.ts`) so the E2E webhook test can assert they actually ran — sync triggers write in the same transaction as the dispatcher mutation.

### Setup Script (`npm run setup`)

The setup script only sets `STRIPE_SECRET_KEY` in the Convex environment. All other setup (webhooks, seeding, syncing) is done through the Admin UI at `/admin/setup`.

### E2E Webhook Test (`npm run e2e:webhooks`)

`scripts/e2e-webhooks.ts` exercises the real pipeline end to end: it deploys the current code, starts `stripe listen --forward-to <site>/stripe/webhook` (setting the deployment's webhook secrets to the CLI session secret), fires every pipeline-supported event via `stripe trigger`, creates a V2 account to emit `v2.core.account.*` thin events, then polls the component webhook ledger and the `triggerLog` table and prints a PASS/FAIL/SKIP table. Requires the Stripe CLI; it reads the test-mode API key from the deployment's `STRIPE_SECRET_KEY`. `payout.paid` and `trial_will_end` are reported as SKIP (not reachable via `stripe trigger`).

#### Money-layer assertions (BTS-49)

**Pre-release only, not CI** — this needs a real (test-mode) Stripe account + a linked Convex dev deployment, so it can't run in CI. It is the release gate that proves the money actually _moves_, which mocks can't catch.

After the event-coverage phase, the harness runs a money phase (`runMoneyAssertions` in the same script, backed by `convex/e2eMoney.ts`) that drives real Stripe test-mode scenarios through the real webhook engine and asserts the persisted ledger:

| Check | What it drives | What it asserts |
| ----- | -------------- | --------------- |
| `money: destination fee` | a $100 destination charge with a $10 `application_fee` | the `payments` row denormalized `feeCollectedAmount=1000` + `destinationAccountId` (the same fee path a destination-charge subscription's invoice takes) |
| `money: split sale` | a $100 separate-charges sale split $80 store / $10 affiliate | **2 `transfers`** ledger rows for the charge (one per recipient) |
| `money: refund reverses transfers` | a refund of the split charge (`reverseTransfer`) | every transfer row has `reversedAmount > 0` (deterministic reversal) |
| `money: dispute reverses transfers` | a disputed split (Stripe `tok_createDispute`) | the `charge.dispute.created` clawback reversed the transfers — **SKIP** (not FAIL) if the async dispute doesn't land in the poll window |

**Test-recipient activation (BTS-9/10 recipe).** Transfers only succeed to an onboarded recipient (an un-activated destination fails `insufficient_capabilities_for_transfer`). `provisionTestRecipient` recreates the validated spike recipe: create a `dashboard: "none"` V2 account requesting the recipient's `stripe_transfers` capability (Express accounts can't accept ToS via the API, so recipients must be `dashboard: none`), then attest identity + ToS so the test SSN `000000000` auto-verifies — **note: the ToS acceptance `date` is an RFC3339 string, not unix**. If activation fails, the whole money phase reports SKIP (never a false PASS).

Gating: set `E2E_SKIP_MONEY=1` to run the event phase only. Any live-drive failure SKIPs the affected money rows with a reason; a genuine wrong outcome FAILs.

> **Status:** the money-assertion code is reviewed + typecheck/lint-clean and unit-covered for its pure reconciliation helper (`e2eMoney.test.ts`), but the full live run (real Stripe + deployment) has **not** been executed yet — run it before a release and re-verify the V2 recipient-activation field paths against current Stripe docs.

### Browser E2E Tests (`npm run e2e`)

A [Playwright](https://playwright.dev) harness lives in `e2e/` with its config in
`playwright.config.ts`. It boots the app in a real Chromium browser and verifies
the shell renders and routes without uncaught page errors.

```bash
# From the repo root (one-time: install the browser binary)
pnpm --filter ./example exec playwright install chromium

# Run the suite (starts the Vite dev server automatically)
pnpm --filter ./example e2e

# View the HTML report from the last run
pnpm --filter ./example e2e:report
```

No backend or Stripe credentials are required: the harness serves the app with a
placeholder `VITE_CONVEX_URL`, so data-backed areas stay in their loading state
by design. To run against a real deployment instead, export `VITE_CONVEX_URL`
before running the suite. `E2E_PORT` (default `5173`) and `E2E_BASE_URL` override
where the dev server is started/expected; an already-running dev server on that
port is reused outside CI.

Demo flows that need seeded data (checkout, disputes, admin actions) are covered
by later specs against a seeded Convex + Stripe test environment — this harness
is the foundation they build on.

**Live-backend specs.** Some specs exercise flows the placeholder backend can't
serve (they persist real changes and rely on webhook-driven sync). These skip by
default and run only with the explicit opt-in `E2E_LIVE_BACKEND=1`, with
`VITE_CONVEX_URL` pointing the harness at a real deployment:

```bash
E2E_LIVE_BACKEND=1 VITE_CONVEX_URL=https://<your-dev-deployment>.convex.cloud \
  pnpm --filter ./example e2e
```

Requirements: a linked Convex dev deployment with the current functions pushed
(`npx convex dev --once`), `STRIPE_SECRET_KEY` set, demo data seeded, and webhook
event destinations configured (via `/admin/setup`) so `product.updated` events
sync back to the UI. Current live-backend specs:

- `e2e/admin-products.spec.ts` — admin product Edit + Deactivate (BTS-59);
  self-contained (creates, edits, then archives its own product).
- `e2e/one-time-checkout.spec.ts` — one-time payment checkout flow (BTS-57);
  see below.
- `e2e/subscription-payout.spec.ts` — paid subscription + payout/balance
  visibility flow (BTS-42); see below.
- `e2e/affiliate-split.spec.ts` — affiliate split breakdown demo (BTS-43);
  see below.
- `e2e/seller-disputes.spec.ts` — seller disputes demo (BTS-44); see below.
- `e2e/marketplace-account.spec.ts` — marketplace account lifecycle (BTS-46);
  see below.
- `e2e/destination-charge.spec.ts` — destination charge + platform fee demo,
  single recipient (BTS-58); see below.

#### One-time payment flow (`e2e/one-time-checkout.spec.ts`)

The one-time checkout demo (BTS-57) has two layers:

- **Backend-independent** (runs everywhere, incl. CI): the payment-mode
  checkout and success routes boot without page errors.
- **Live flow** (skipped unless `E2E_LIVE_BACKEND=1`): landing → the seeded
  one-time product (Ceramics Masterclass, from the marketplace seed) →
  embedded Stripe checkout in `payment` mode → test card `4242…` → Stripe
  redirects to `/checkout/status?session_id=cs_…` → "Payment successful!" with
  the one-time purchase copy. Additional requirement on top of the list above:
  webhook forwarding so the session status flips to `complete`:

  ```bash
  stripe listen --forward-to <your-site-url>/stripe/webhook
  ```

The session's mode is derived server-side in
`convex/actions.ts#createCheckoutSession`: one-time prices get
`mode: "payment"`, recurring prices `mode: "subscription"`.

#### Paid subscription + payout flow (`e2e/subscription-payout.spec.ts`)

A real paid subscription demo (BTS-42) that shows the marketplace money model
end to end: a buyer subscribes to a seeded store's recurring plan as a
**destination charge**, and the seller sees the money via balance + payouts while
the platform keeps its fee. Backend in `convex/marketplace.ts`; pages under
`/demo/*`.

- **`/demo/subscribe`** — buyer (Billie) subscribes to Maya's Fitness Studio
  monthly plan. `createStoreSubscriptionCheckout` opens an embedded checkout in
  `subscription` mode routed to the store via `destinationAccountId`, with a
  per-call `fee: { percent: 10 }`. No trial → the first invoice charges
  immediately (a real charge). The percent-only override rides on Stripe's
  `application_fee_percent`, which applies to every invoice (including the
  first) and gives the demo a clean, deterministic 10% fee to display.
- **`/demo/store-earnings`** — the store's balance + rolling payouts via the
  merged `PayoutSchedule`, earnings via the merged `EarningsSummary` (derived
  from the balance snapshot + payouts, since a destination charge leaves no
  transfer-ledger row — that ledger, which `useEarnings` reads, is the
  separate-charges split view), and the platform fee on the resulting invoice.

Two layers, like the one-time flow: a backend-independent boot check (both routes
render without page errors) and a live flow gated on `E2E_LIVE_BACKEND=1`
(embedded checkout → test card → the store-earnings page shows the 10% platform
fee). The live flow also needs webhook forwarding (`stripe listen`) so the
charge/invoice/payout events sync.

**Manual QA steps**

1. Seed a live deployment: set `STRIPE_SECRET_KEY`, run
   `pnpm --filter ./example run setup`, and configure webhook destinations via
   `/admin/setup`. Start webhook forwarding:
   `stripe listen --forward-to <your-site-url>/stripe/webhook`.
2. Open `/demo/subscribe`. Confirm it resolves the store (Maya's Fitness Studio)
   and its monthly price, and shows the 10% platform-fee line.
3. Complete the embedded checkout with test card `4242 4242 4242 4242`, any
   future expiry, any CVC. Confirm it's a real charge (no trial) and you're
   redirected to `/demo/store-earnings`.
4. On `/demo/store-earnings`, confirm: **Latest sale — platform fee** shows the
   charge, the 10% platform fee, and the seller net; **Balance & payouts** shows
   an available/pending balance reflecting the transfer (payouts appear once
   Stripe's rolling schedule runs — the balance moves first); **Earnings** shows
   gross/net/paid-out. (Webhook sync takes a few seconds; refresh if needed.)

#### Affiliate split flow (`e2e/affiliate-split.spec.ts`)

The affiliate split breakdown demo (BTS-43) — the headline proof: **one $100
sale, three destinations**. Route: `/marketplace/split` (also in the customer
nav as "Affiliate Split"). An affiliate referral flows in via the `?ref=avery`
query param; the sale routes store + affiliate, and the platform takes its
configured tiered fee. The result is visualized with the headless
`SplitBreakdown` (store / affiliate / platform) and `EarningsSummary`, driven by
the `useSplitBreakdown` / `useEarnings` hooks.

Two layers:

- **Backend-independent** (runs everywhere, incl. CI): the demo route boots
  without app page errors, plain and with `?ref=avery`. (The Convex client's
  placeholder-URL connection fatal is filtered — that is the intended
  backend-independent boundary.)
- **Live flow** (skipped unless `E2E_LIVE_BACKEND=1`): a referred purchase →
  the webhook engine creates the store + affiliate transfers → the three-way
  breakdown reconciles to the $100 charge.

**Manual QA steps** (against a seeded, webhook-forwarded dev deployment):

1. Seed the marketplace: `npm run setup` (creates Maya's store + Avery Affiliate
   and Maya's one-time $100 "1:1 Session" price), and forward webhooks:
   `stripe listen --forward-to <your-site-url>/stripe/webhook`.
2. Visit `/marketplace/split?ref=avery`. Confirm the attribution badge reads
   **"Referred by Avery Affiliate"** (visit without `?ref` → "No referral").
3. Click **Buy with test card**; in the embedded Stripe form pay with
   `4242 4242 4242 4242`, any future expiry, any CVC. You land on
   `/checkout/status`.
4. Return to `/marketplace/split?ref=avery`. Under **Latest sale — split
   breakdown**, confirm three lines — **Store**, **Affiliate**, **Platform** —
   and that Store + Affiliate + Platform **reconcile to $100.00** (the platform
   line = charge − store − affiliate). The **Affiliate earnings** panel shows
   Avery's gross/net.

Attribution and the split-leg math are unit-tested in
`convex/affiliate-split.test.ts`; the split executes as separate transfers via
the webhook engine (see `stripe.ts` `platformFee` for the platform's cut).

#### Seller disputes flow (`e2e/seller-disputes.spec.ts`)

The seller disputes demo (BTS-44) is the culminating dispute demo: a
seller-facing `/seller/disputes` page that exercises the whole merged dispute
stack. It offers two surfaces via tabs:

- **Headless components:** `useDisputes` → `DisputesList` (status + due-by
  countdown), and on selecting a row `useDisputeWithCountdown` →
  `DisputeDetail` + `EvidenceForm`. Submitting evidence calls the
  `submitDisputeEvidence` action (`convex/actions.ts`), which forwards to
  `stripe.updateDispute`.
- **Embedded (Stripe Connect):** `ConnectProvider` + `EmbeddedDisputes`, fed by
  the `createDisputeSession` action (`stripe.createDisputeSession`, BTS-30).

Two layers, like the checkout demo:

- **Backend-independent** (runs everywhere, incl. CI): the `/seller/disputes`
  route boots without page errors.
- **Live flow** (skipped unless `E2E_LIVE_BACKEND=1`): open the disputes page →
  open a dispute → submit evidence → observe the transfer reversal +
  subscription auto-cancel. Requires a seeded deployment, `STRIPE_SECRET_KEY`,
  webhook forwarding, and a triggered test dispute (below). This spec's live
  test stays skipped — and the ticket's live-E2E box unchecked — until the
  first live run.

##### Manual QA steps (dispute end-to-end)

Against a seeded dev deployment with `stripe listen` forwarding webhooks:

1. **Onboard a seller** and create a subscription for a buyer against that
   seller's store (so there is a funded transfer + an active subscription to
   claw back / cancel).
2. **Trigger a test dispute** on the subscription's charge. Either use the
   Stripe CLI:

   ```bash
   stripe trigger charge.dispute.created
   ```

   or create a charge with the disputed test card `4000000000000259` (dispute:
   fraudulent) and let it settle. Stripe emits `charge.dispute.created`, which
   the component records and (per BTS-27/28) claws back the funded transfer and
   auto-cancels the buyer's subscription.
3. **Open `/seller/disputes`** as the seller persona (role switcher). The
   dispute appears in the headless list with its status and, if a deadline
   exists, a due-by countdown badge.
4. **Select the dispute** → the detail panel shows amount / reason / status /
   evidence-due, and the evidence form renders.
5. **Fill the four evidence fields and Submit.** The `submitDisputeEvidence`
   action calls `stripe.updateDispute({ submit: true })`; the response is filed
   with Stripe (no redirect — this is the embedded/headless flow).
6. **Observe the side effects:** the seller's earnings/transfers reflect the
   reversal, and the buyer's subscription shows canceled/`cancel_at_period_end`.
7. **(Optional) Embedded tab:** switch to "Embedded (Connect)" to view the same
   disputes via Stripe's hosted `disputes_list` component.

Note: `charge.dispute.funds_withdrawn` / `funds_reinstated` cannot be reliably
triggered in test mode, so the reversal ledger is best verified via the
`charge.dispute.created` clawback path above.

#### Marketplace account lifecycle (`e2e/marketplace-account.spec.ts`)

The marketplace account demo (BTS-46) shows "one V2 account, configurations
accrue": a single Stripe account is both a payouts recipient and a billable
customer. Two layers:

- **Backend-independent** (runs everywhere, incl. CI): `/seller/marketplace-account`
  boots without page errors, both pre-onboarding and when returning from a
  (placeholder) purchase session. The page is role-gated (`seller`), preset
  via `localStorage` the same way the admin specs do.
- **Live flow** (skipped unless `E2E_LIVE_BACKEND=1`): seller onboards via
  hosted Stripe Express as a `recipient` → adds the `customer` configuration
  to the SAME account → buys a seeded one-time platform price as that
  account → lands back on the page with a "Purchase complete" confirmation.
  Same webhook-forwarding requirement as the one-time checkout flow above.

  > The hosted Express onboarding form's exact field selectors are not yet
  > verified against a live test-mode session (no live Stripe access when
  > this spec was written) — the live-flow test is structured and documented
  > but its first phase needs a pass against a real deployment before it's
  > reliable. See the `TODO(first live run)` comment in the spec.

Manual QA (until the live-E2E spec is verified against a real deployment):

1. As the `seller` role, visit `/seller/marketplace-account`. With no account
   yet, pick a country and click **Onboard as recipient** — you're redirected
   to hosted Stripe Express.
2. Complete the Express onboarding form (test-mode identity + bank details).
   Stripe redirects back to `/seller/marketplace-account`.
3. Once **Applied Configurations** shows `Recipient (payouts)` and onboarding
   is `complete`, click **Add customer configuration** — the badge list
   should grow to include `Customer (billable)`.
4. Pick a seeded one-time price from **Step 2 — Buy Something as This
   Account** and click **Buy as this account**. Complete Stripe Checkout with
   the test card `4242 4242 4242 4242`.
5. After the redirect back, confirm the **Purchase complete** banner appears
   — the same `stripeAccountId` that receives payouts (as `recipient`) was
   just charged as a customer (`customer_account` on the Checkout Session).
6. If the account was NOT recipient+merchant from the start, use **Step 3 —
   Add More Configurations Later** to add whichever is missing and confirm
   the badge list updates (demonstrates configurations accruing over time,
   not just at creation).

#### Destination charge + platform fee flow (`e2e/destination-charge.spec.ts`)

The destination-charge + platform-fee demo (BTS-58) — the simplest single-
recipient case: one seller (Sasha's Ceramics), one one-time charge, no
affiliate routing. Route: `/demo/destination-charge`. A buyer (Billie) buys
Sasha's seeded $129 one-time price; funds route to Sasha's connected account
as a destination charge, and the platform keeps its 10% application fee. The
fee/payout breakdown is computed up front from the known price
(`getDestinationChargeDemoContext`) and confirmed inline once Stripe redirects
back with the real session id (reusing the BTS-62 `buildCheckoutReturnUrl`
helper, generalized to point at this page instead of the generic
`/checkout/status`).

Two layers, like the other demos:

- **Backend-independent** (runs everywhere, incl. CI): the demo route boots
  without page errors, plain and with a `session_id` query param.
- **Live flow** (skipped unless `E2E_LIVE_BACKEND=1`): a purchase → the
  charge completes → the fee/payout breakdown reconciles exactly to the
  charge amount (`fee + payout == charge`, asserted both by the pure
  `reconciles()` helper's unit tests and by the live spec).

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
│   ├── seed.ts                 # Seed DB + Stripe products + marketplace scenario
│   ├── reset.ts                # Clear all data
│   └── users.ts                # User queries
├── e2e/
│   ├── smoke.spec.ts           # Playwright smoke test (app boots + routes)
│   └── one-time-checkout.spec.ts # One-time payment flow (live part gated)
├── scripts/
│   └── setup.ts                # Sets STRIPE_SECRET_KEY in Convex env
├── playwright.config.ts        # Playwright harness (dev-server wiring)
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
| `npm run e2e`              | Playwright browser E2E suite (see below)    |
| `npm run e2e:report`       | Open the last Playwright HTML report        |
| `npm run e2e:webhooks`     | Automated E2E webhook test (see below)      |
| `npm run dev`              | Start Vite + Convex dev in parallel         |
| `npm run typecheck`        | TypeScript check (frontend)                 |
| `npm run typecheck:convex` | TypeScript check (Convex functions)         |
| `npm run lint`             | ESLint                                      |
| `npm run build`            | Production build                            |
| `npx convex run reset:run` | Clear all data                              |
