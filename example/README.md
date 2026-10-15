# BetterStripe example

A Vite + React SPA demonstrating the `better-stripe` backend and reusable React workflows.
All data comes from Stripe via better-stripe -- no mock data.

## Quick Start

```bash
pnpm install
pnpm build
cd example
pnpm exec convex dev --once
```

**Set the Stripe secret key:**

```bash
pnpm run setup
```

This reads `STRIPE_SECRET_KEY` from `.env.local` and sets it as a Convex environment variable. That's all the CLI setup does.

**Start the app:**

```bash
pnpm run dev
```

Open **http://localhost:5173** and go to **/admin/setup** to finish setup:

1. Set up webhook event destinations (V1 snapshot + V2 thin)
2. Seed demo data (users + Stripe products/prices)
3. Sync existing Stripe data (products, subscriptions, accounts)

### Reset & Re-seed

```bash
pnpm exec convex run reset:run   # Clear all data (app DB + better-stripe component DB)
pnpm run setup               # Re-set the Stripe key
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
- **Seller store plans** -- `/seller/plan` charges $9/month for Starter,
  $49/month for Growth, or $99/month for Pro. A paid, active plan is required
  for store listings and new purchases. Starter takes the greater of 9% or
  actual Stripe processing; Growth takes the greater of 4.9% or actual
  processing; Pro takes processing only. The platform keeps the difference
  and never subsidizes processing. New sales wait for actual Stripe fees,
  then transfer the remainder to the seller and, for referrals, the affiliate.
  The affiliate receives the effective percentage of the remainder or a fixed amount capped at that remainder after the inclusive sale fee. Unconfigured affiliate payouts default to 0%.
  Existing customer renewals continue using the seller's current or last paid
  tier, even if the store has closed to new purchases. Use Stripe's billing
  portal for paid plan changes, payment details, invoices, and cancellation.
  The older fee configuration in `convex/stripe.ts` remains for standalone
  legacy component demos.
- **Affiliate** (`Avery Affiliate`) -- a recipient-only account, activated the
  same way, for referral-share transfers in split sales.
- **Buyer** (`Billie Buyer`) -- a billable `customer_account` with a reusable
  test card (`pm_card_visa`) attached, so purchases can charge off-session.

### Prerequisites

- Node.js 22.12+ (required by the Vite development server)
- pnpm 10 (the workspace package manager)
- A Stripe account with a test-mode secret key
- Copy `.env.local.example` to `.env.local` and fill in your keys:
  ```
  VITE_CONVEX_URL=             # from `pnpm exec convex dev`
  VITE_STRIPE_PUBLISHABLE_KEY= # pk_test_...
  STRIPE_SECRET_KEY=           # sk_test_... (used by setup script)
  VITE_CONVEX_SITE_URL=        # https://your-deployment.convex.site
  ```

## Architecture

All Stripe data flows through the `better-stripe` Convex component.
The app uses the component for account and billing data. Seller plans and sale settlement also use the Stripe SDK to verify paid subscriptions and read actual processing fees. The main integration files are:

- **`convex/stripe.ts`** -- `BetterStripe` client instance with triggers and hooks
- **`convex/queries.ts`** -- Query wrappers exposing component data to the frontend
- **`convex/actions.ts`** -- Action wrappers for Stripe API calls (checkout, accounts, webhooks, payment methods)
- **`convex/http.ts`** -- Webhook endpoint via `registerRoutes()` with dual webhook secrets (V1 + V2)

## Roles

Use the role switcher in the header to explore five perspectives:

- **Visitor**: browse `/stores` and buy from a seller without an app account, including through affiliate links. Guest checkout does not borrow a seeded customer's identity.
- **Customer**: buy from sellers and manage personal subscriptions, invoices, and payment methods.
- **Seller**: manage store products, subscriptions, earnings, payouts, and the connected Stripe account. The seller selector switches between Maya, Sasha, and Jordan.
- **Affiliate**: Avery has a separate Stripe account, referral links, and an earnings ledger at `/affiliate`. Customers do not receive affiliate payouts.
- **Admin**: manage the platform's catalog, subscriptions, webhooks, testing, and setup.

A referred sale takes the configured platform fee first, pays Avery the effective percentage of the remainder or a fixed amount capped at that remainder, and pays the seller the rest, including any final rounding cent. A direct sale pays the seller the entire remainder. `/stores?store=<seller-account>&ref=avery` keeps attribution through checkout and role switching.

The old `/marketplace/split` and `/demo/destination-charge` links redirect to the storefront. `/demo/subscribe` now lists the active seller's subscriptions; `/demo/store-earnings` reads that seller's balance and payouts. Customers purchase recurring plans from the store catalog.

The role menu, command menu, and route redirects use the same role rules. These are demonstration UI boundaries, not authentication.

For the opt-in local sandbox browser checks, run `E2E_LIVE_BACKEND=1 pnpm exec playwright test marketplace-roles.spec.ts` from `example/`. These tests use a normal browser and record video. They create synthetic test-mode payments and a subscription; see [the October 13 QA report](QA-2026-10-13.md) for coverage and remaining limits.

## Demo security model

This app has **no real authentication**. The role switcher just picks a
seeded persona and every Convex call passes that persona's `userId` as a
plain argument -- nothing cryptographically proves the request came from
that persona (see `userId: ""`, the app's sentinel for an unattributed
record, used e.g. by webhook-synced rows with no known owner). Anyone
calling an action directly (devtools, a script) can pass any `userId` they
like.

Given that, **ownership checks in this app are a binding, not
authentication**: every state-changing action (subscription lifecycle,
disputes, refunds, transfer reversals) loads its target resource
server-side and verifies the resource's persisted owner -- a
subscription's `userId`, or a payment/dispute/transfer's connected
Stripe account -- matches the `userId` the caller claims, **before** any
Stripe side effect runs. This stops a client from operating on someone
else's subscription, dispute, or sale even though it can claim to be
anyone; it does not stop a client from lying about which persona it is,
because there is no session to check that against. The shared gate lives
in `convex/authz.ts` (`assertOwnership` plus a per-resource
`assert*Owner` wrapper for subscriptions, seller accounts, disputes,
payments, and transfers) and replaces the narrower `assertSubscriptionOwner`
subscription price-ownership check.

Money-moving and dispute-closing actions (`issueRefund`,
`reverseSaleTransfers`, `acceptDispute`) are also gated by
`assertTestModeStripeKey` (`convex/authz.ts`, shared with the admin Testing
page's test-mode guard) **before** any Stripe call: it fails closed unless
`STRIPE_SECRET_KEY` is an unambiguous `sk_test_`/`rk_test_` key. **Never
deploy this example with a live secret key** -- these actions make real
Stripe API calls, and the whole app assumes test mode throughout (see the
E2E money-layer notes below).

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

The marketplace account demo (`/seller/marketplace-account`) is the
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

### Setup Script (`pnpm run setup`)

The setup script only sets `STRIPE_SECRET_KEY` in the Convex environment. All other setup (webhooks, seeding, syncing) is done through the Admin UI at `/admin/setup`.

### E2E Webhook Test (`npm run e2e:webhooks`)

`scripts/e2e-webhooks.ts` exercises the real pipeline end to end: it deploys the current code, starts `stripe listen --forward-to <site>/stripe/webhook` (setting the deployment's webhook secrets to the CLI session secret), fires every pipeline-supported event via `stripe trigger`, creates a V2 account to emit `v2.core.account.*` thin events, then polls the component webhook ledger and the `triggerLog` table and prints a PASS/FAIL/SKIP table. Requires the Stripe CLI; it reads the test-mode API key from the deployment's `STRIPE_SECRET_KEY`. `payout.paid` and `trial_will_end` are reported as SKIP (not reachable via `stripe trigger`).

#### Money-layer assertions

**Pre-release only, not CI** — this needs a real (test-mode) Stripe account + a linked Convex dev deployment, so it can't run in CI. It is the release gate that proves the money actually _moves_, which mocks can't catch.

After the event-coverage phase, the harness runs a money phase (`runMoneyAssertions` in the same script, backed by `convex/e2eMoney.ts`) that drives real Stripe test-mode scenarios through the real webhook engine and asserts the persisted ledger:

| Check                                                           | What it drives                                                                                                                                                                 | What it asserts                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `money: destination fee`                                        | a $100 destination charge with a $10 `application_fee`                                                                                                                         | the `payments` row denormalized `feeCollectedAmount=1000` + `destinationAccountId` (the same fee path a destination-charge subscription's invoice takes)                                                                                                                                                                                                                                               |
| `money: split sale`                                             | a $100 separate-charges sale split $80 store / $10 affiliate                                                                                                                   | **2 `transfers`** ledger rows for the charge (one per recipient)                                                                                                                                                                                                                                                                                                                                       |
| `money: refund reverses transfers`                              | a refund of the split charge (`reverseTransfer`)                                                                                                                               | each transfer row reversed to its **exact** amount — store `8000` / affiliate `1000` (exact reversal assertions: not merely `> 0`)                                                                                                                                                                                                                                                                     |
| `money: full refund of a per-charge-fee sale caps the reversal` | a $100 destination charge tagged `bsFeeMode=per_charge` (3.2% → $3.20 collected by partial transfer reversal, the per-charge fees path), then a FULL refund with default flags | the fee lands on the `payments` row (`feeCollectedAmount=320`); the refund succeeds and marks it `fully_refunded` for 10000; the live transfer shows **exactly two reversals** — the preserved 320 fee + the refund reversal **capped at 9680** (`amount_reversed == amount`). Live-verified 2026-07-03: Stripe caps instead of erroring; a refund **error** on this row is a genuine FAIL, not a SKIP |
| `money: dispute reverses transfers`                             | a disputed split (Stripe `tok_createDispute`)                                                                                                                                  | the `charge.dispute.created` clawback reversed the transfers to their **exact** amounts (store `8000` / affiliate `1000`)                                                                                                                                                                                                                                                                              |

**Reversal amounts are asserted exactly.** The refund and dispute checks use `reversalsMatchExactly` (pure, unit-tested in `example/scripts/money-assertions.ts`) to require each leg's `reversedAmount` to equal its expected pro-rata value — a partial, missing, over-, or wrong-role reversal FAILs. A full refund / full-amount dispute of the $80/$10 split reverses each leg completely (verified against `computeReversalSlices`).

**Dispute: FAIL vs SKIP.** The dispute check no longer SKIPs indiscriminately on timeout. It polls the `disputes` ledger for the disputed charge's PaymentIntent (`listDisputesForPaymentIntent`):

- dispute row **never landed** in the window (async timing) → **SKIP** (the genuinely-couldn't-verify case), but
- dispute row **landed** yet the transfers weren't reversed to the exact amounts (broken clawback wiring) → **FAIL**.

So a real clawback regression can no longer pass the gate silently.

**Test-recipient activation.** Transfers only succeed to an onboarded recipient (an un-activated destination fails `insufficient_capabilities_for_transfer`). `provisionTestRecipient` recreates the validated spike recipe: create a `dashboard: "none"` V2 account requesting the recipient's `stripe_transfers` capability (Express accounts can't accept ToS via the API, so recipients must be `dashboard: none`), then attest identity + ToS so the test SSN `000000000` auto-verifies — **note: the ToS acceptance `date` is an RFC3339 string, not unix**. Two more requirements verified live 2026-07-03: the create must include `contact_email` **and** `defaults.responsibilities` (`losses_collector`/`fees_collector: "application"`) or Stripe rejects it with `invalid_fields`, and the capability activates **asynchronously** (seconds) — `provisionTestRecipient` now polls for `active` before returning, since a transfer sent too early fails. If activation fails, the whole money phase reports SKIP (never a false PASS).

Gating: set `E2E_SKIP_MONEY=1` to run the event phase only. A legitimate live-drive failure (recipient provisioning, the dispute never landing) SKIPs the affected rows with a reason; a genuine wrong outcome — including a landed-but-not-reversed dispute — FAILs. **No false PASS, no false FAIL.**

> **Status:** the money-assertion code is reviewed + typecheck/lint-clean and unit-covered for its pure helpers (`e2eMoney.test.ts` — reconciliation, exact-reversal matching, and the refund reversal cap plan), but the full harness live run (real Stripe + deployment) has **not** been executed yet — run it manually before a release (`pnpm exec convex dev --once` in `example/` to push the current functions, then `pnpm --filter ./example run e2e:webhooks`); it is not CI-runnable. The refund reversal scenario's underlying Stripe behavior (recipient-create requirements, async capability activation, the full-refund reversal **cap**) WAS verified live on 2026-07-03 by direct API probe — the harness row re-verifies it end-to-end through the webhook engine on each release run.

### Direct checkout and Express login fixtures

The live direct checkout test verifies the actual Stripe destination transfer,
platform fee, and store account through an internal, read-only action that
rejects live Stripe keys. Run against the seeded development deployment:

```sh
E2E_LIVE_BACKEND=1 pnpm e2e e2e/affiliate-split.spec.ts e2e/express-login.spec.ts --workers=1
```

Express login requires the seeded seller to use an Express dashboard and have
completed sandbox onboarding. Use Stripe's test phone/code and test bank
credentials during hosted onboarding. Inspect readiness from `example/` with
`pnpm exec convex run e2eCheckout:inspectSeller '{}'`; expect `dashboard: express`,
`detailsSubmitted`, `chargesEnabled`, and `payoutsEnabled` to be true, with no
currently due requirements. The login test verifies the hosted login handoff for the account displayed by
the app. Stripe may challenge headless browsers with CAPTCHA; opt into full
hosted dashboard assertions with `E2E_STRIPE_HOSTED_LOGIN=1` only in a browser
environment that can complete normal Stripe login. Login URLs are single-use
and must not be saved in reports.

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
(`pnpm exec convex dev --once`), `STRIPE_SECRET_KEY` set, demo data seeded, and webhook
event destinations configured (via `/admin/setup`) so `product.updated` events
sync back to the UI. Current live-backend specs:

- `e2e/admin-products.spec.ts` — admin product Edit + Deactivate;
  self-contained (creates, edits, then archives its own product).
- `e2e/one-time-checkout.spec.ts` — one-time payment checkout flow;
  see below.
- `e2e/subscription-payout.spec.ts` — paid subscription + payout/balance
  visibility flow; see below.
- `e2e/affiliate-split.spec.ts` — affiliate split breakdown demo;
  see below.
- `e2e/seller-disputes.spec.ts` — seller disputes demo; see below.
- `e2e/marketplace-account.spec.ts` — marketplace account lifecycle;
  see below.
- `e2e/destination-charge.spec.ts` — destination charge + platform fee demo,
  single recipient; see below.
- `e2e/refunds-reversals.spec.ts` — refunds & reversals seller ops page
  ; see below.

#### One-time payment flow (`e2e/one-time-checkout.spec.ts`)

The one-time checkout demo has two layers:

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

#### Customer purchases and seller finances (`e2e/marketplace-roles.spec.ts`)

The live marketplace suite checks every role's pages, guest referred checkout, direct customer checkout, and a customer subscription with pause/resume. Payments use Stripe's synthetic Visa and the configured sandbox. Tests read the stored checkout identity and actual Stripe payment or transfer ledger before asserting success.

Visit `/stores` as Customer or Visitor to choose a seller and price. Recurring plans open subscription checkout; one-time prices open payment checkout. The return page displays the purchased product. Customer billing is scoped to that customer's ID, while seller subscriptions and earnings use the store selected in the seller sidebar.

Avery's referral links are on `/affiliate/links`. Opening a link and choosing Customer or Visitor preserves `ref=avery` through checkout. A referred sale pays the platform fee first, then Avery receives the effective percentage of the remainder or a fixed amount capped at that remainder and the seller receives the rest. View the affiliate's own transfer ledger on `/affiliate`. The old `/marketplace/split` route redirects to this storefront; its compatibility behavior is covered by `e2e/affiliate-split.spec.ts`.

The live suite records normal-browser video because direct Stripe checkout stalled in headless Chromium during this QA run. The ordinary boot suite remains independent of Stripe credentials. See [October 13 QA](QA-2026-10-13.md) for amounts, evidence, and coverage limits.

#### Seller disputes flow (`e2e/seller-disputes.spec.ts`)

The seller disputes demo is the culminating dispute demo: a
seller-facing `/seller/disputes` page that exercises the whole merged dispute
stack. It offers two surfaces via tabs:

- **Headless components:** `useDisputes` → `DisputesList` (status + due-by
  countdown), and on selecting a row `useDisputeWithCountdown` →
  `DisputeDetail` + `EvidenceForm`. Submitting evidence calls the
  `submitDisputeEvidence` action (`convex/actions.ts`), which forwards to
  `stripe.updateDispute`.
- **Embedded (Stripe Connect):** `ConnectProvider` + `EmbeddedDisputes`, fed by
  the `createDisputeSession` action (`stripe.createDisputeSession`).

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
   the component records and (per dispute handling) claws back the funded transfer and
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

The marketplace account demo shows "one V2 account, configurations
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

#### Direct seller payment (`e2e/destination-charge.spec.ts`)

The legacy `/demo/destination-charge` route redirects to `/stores`. It no longer creates a checkout for a fixed seeded buyer. Direct seller checkout and actual application-fee assertions are in `e2e/marketplace-roles.spec.ts`: a $100 direct Starter-plan sale has a $9 inclusive sale fee. If Stripe processing is $3.20, the platform retains $5.80 and the seller receives $91.00.

#### Refunds & reversals (`e2e/refunds-reversals.spec.ts`)

Seller ops page at `/seller/refunds` for the two claw-back
primitives the money layer needs: `issueRefund` (full or partial, by
PaymentIntent id) and a standalone `reverseSaleTransfers` (full or partial,
by source charge id) for when ops needs a manual transfer clawback outside
of a refund. A payment-status panel and a refund-history table (scoped to
one PaymentIntent or all refunds) read back what actually landed.

Two layers, like the other demos:

- **Backend-independent** (runs everywhere, incl. CI): the route boots
  without page errors.
- **Live flow** (skipped unless `E2E_LIVE_BACKEND=1`): the refund and
  reversal controls, payment-status figures, and refund-history table
  render against a seeded deployment.

#### Admin Testing utilities (`e2e/admin-testing.spec.ts`)

`/admin/testing` demonstrates `better-stripe/testing` exports for
development and test workflows: `assertTestEnvironment()` (an environment
guard demo), buttons that fire **real** test-mode webhook triggers
(`fireCheckoutCompleted`, `fireSubscriptionUpdated`, `fireAccountUpdated`,
`fireInvoicePaid`) against the seeded marketplace scenario and poll the
component ledger for the synced row, and fixture-factory buttons that log
typed test-data shapes for account/product/price/subscription. Money-moving
actions elsewhere in the app share this page's `assertTestModeStripeKey`
test-mode guard (demo test-mode guard; see "Demo security model" above).

Backend-independent only: the route boots without page errors.
Actually firing the webhook triggers against a real ledger is exercised
manually, and by the `npm run e2e:webhooks` money-layer harness (see
"Money-layer assertions" above), not this boot spec.

#### Seller product catalog (`/seller/products`)

The seller's own view of `stripe.listProducts()` / `listPricesByProduct()`
scoped to their connected account (`accountId`): expand a product to see its
prices, create a new product + price (`createProductForAccount`,
`createPrice`), and deactivate a price (`deactivatePrice`) — the
deactivate action binds the caller to the price's owning connected account,
so a seller can only ever touch their own catalog.

Covered by the seller-pages boot-check batch (`e2e/seller-pages.spec.ts`): the route boots without page errors alongside the other seller
pages.

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
│   ├── convex.config.ts          # app.use(betterStripe)
│   ├── schema.ts                 # users table only
│   ├── http.ts                   # registerRoutes() webhook endpoint (V1 + V2)
│   ├── stripe.ts                 # BetterStripe client + triggers + hooks
│   ├── queries.ts                # Query wrappers for component data
│   ├── actions.ts                # Action wrappers for Stripe API calls + admin setup
│   ├── authz.ts                  # assertOwnership + per-resource assert*Owner, assertTestModeStripeKey
│   ├── setup.ts                  # ensureWebhook action (legacy, used by setup script)
│   ├── seed.ts                   # Seed DB + Stripe products + marketplace scenario
│   ├── reset.ts                  # Clear all data
│   ├── users.ts                  # User queries
│   ├── marketplace.ts            # Store subscription checkout + earnings/payout helpers
│   ├── affiliateSplit.ts         # Referral attribution + split-sale math
│   ├── subscriptionLifecycle.ts  # Buyer subscription cancel/resume lifecycle
│   ├── triggerLogger.ts          # triggerLog table writer for sync triggers + async hooks
│   ├── e2eMoney.ts               # Money-layer assertions backend for e2e:webhooks
│   ├── lib/
│   │   └── marketplace.ts        # Pure fee/catalog helpers shared by actions.ts + the frontend
│   └── *.test.ts                 # Vitest unit tests colocated per module above
├── e2e/                          # Playwright suite (see "Browser E2E Tests" below)
│   ├── smoke.spec.ts             # App boots + routes (backend-independent)
│   ├── admin-pages.spec.ts       # Admin pages boot-check
│   ├── admin-products.spec.ts    # Admin product Edit + Deactivate
│   ├── admin-testing.spec.ts     # Admin Testing page boot-check
│   ├── dashboard-pages.spec.ts   # Customer dashboard pages boot-check
│   ├── seller-pages.spec.ts      # Seller pages boot-check
│   ├── seller-onboarding.spec.ts # Seller onboarding flow boot-check
│   ├── payment-methods.spec.ts   # Payment methods page boot-check
│   ├── nav-demo-links.spec.ts    # Nav sidebar demo route links boot-check
│   ├── one-time-checkout.spec.ts # One-time payment flow
│   ├── subscription-payout.spec.ts    # Paid subscription + payout flow
│   ├── affiliate-split.spec.ts        # Affiliate split breakdown demo
│   ├── seller-disputes.spec.ts        # Seller disputes demo
│   ├── dispute-chargeback.spec.ts     # Dispute + chargeback lifecycle
│   ├── marketplace-account.spec.ts    # Marketplace account lifecycle
│   ├── destination-charge.spec.ts     # Destination charge + platform fee demo
│   ├── refunds-reversals.spec.ts      # Refunds & reversals seller ops page
│   └── buyer-subscription-lifecycle.spec.ts  # Buyer subscription lifecycle
├── scripts/
│   ├── setup.ts                  # Sets STRIPE_SECRET_KEY in Convex env
│   ├── e2e-webhooks.ts           # Automated webhook + money-layer E2E test (see below)
│   └── money-assertions.ts       # Pure reversal/reconciliation helpers (unit-tested)
├── playwright.config.ts          # Playwright harness (dev-server wiring)
├── src/
│   ├── main.tsx                  # BrowserRouter + ConvexProvider
│   ├── App.tsx                   # Routes
│   ├── components/ui/            # shadcn/ui components
│   ├── components/
│   │   ├── app-shell.tsx         # Layout: header + sidebar
│   │   ├── role-switcher.tsx     # Role toggle
│   │   └── nav-sidebar.tsx       # Role-aware navigation
│   ├── pages/
│   │   ├── landing.tsx           # Pricing (real products from Stripe)
│   │   ├── checkout.tsx          # EmbeddedCheckout
│   │   ├── checkout-status.tsx   # CheckoutStatus
│   │   ├── dashboard/            # Customer: billing, invoices, payment methods
│   │   ├── seller/               # Seller: onboarding, account, payouts, products, refunds
│   │   ├── admin/                # Admin: products, subscriptions, webhooks, setup, testing
│   │   ├── demo/                 # Marketplace money-model demos: subscribe, store-earnings, destination-charge
│   │   └── marketplace/          # Affiliate split breakdown demo (split.tsx)
│   ├── providers/
│   │   └── role-context.tsx      # Demo role switcher (mock auth)
│   └── lib/                      # Pure helpers shared by pages (checkout-return-url,
│                                  # store-earnings, current-subscription, stripe-hooks,
│                                  # dispute-hooks), each with a colocated *.test.ts
├── .env.local.example
└── package.json
```

## Scripts

| Command                          | Description                                 |
| -------------------------------- | ------------------------------------------- |
| `pnpm run setup`                 | Set STRIPE_SECRET_KEY in Convex environment |
| `npm run e2e`                    | Playwright browser E2E suite (see below)    |
| `npm run e2e:report`             | Open the last Playwright HTML report        |
| `npm run e2e:webhooks`           | Automated E2E webhook test (see below)      |
| `pnpm run dev`                   | Start Vite + Convex dev in parallel         |
| `npm run typecheck`              | TypeScript check (frontend)                 |
| `npm run typecheck:convex`       | TypeScript check (Convex functions)         |
| `npm run lint`                   | ESLint                                      |
| `npm run build`                  | Production build                            |
| `pnpm exec convex run reset:run` | Clear all data                              |

## Populated Stripe sandbox

The example always uses a Stripe sandbox. There is no offline mock mode.
After configuring the sandbox key and webhook destination, open Admin → Setup
and choose Seed Data. Seeding automatically starts a resumable fixture job.
Its progress and any retryable failure appear on that page. You can also start
or resume it from the example directory:

```sh
pnpm exec convex run sandboxFixtures:start
pnpm exec convex run sandboxFixtureState:status
```

The fixture pack creates 40 sandbox sales, six refunds, four disputes with open,
won, and lost outcomes, referred purchases, a customer subscription, paid monthly
seller plans, and three connected-account payouts. These are real sandbox Stripe
objects, created with Stripe's test payment methods. Stripe webhooks populate the
same component ledger used by interactive purchases. Running the job again
recovers its existing resources rather than repeating completed charges.
The Express seller remains an interactive onboarding example; automatic sales
wait for both the seller and affiliate recipient capabilities to become active
before creating a payment. Stripe verification can take several minutes; the
job retries recipient readiness for up to five minutes per step. Other transient
failures use a shorter retry budget, and permanent failures remain visible for
resumption after correction.

Refund and dispute costs are read from Stripe balance transactions. Costs that
are not covered by the retained sale fee are deducted from subsequent seller
transfers before payout. Any outstanding amount is attached to the next monthly
store invoice; returned costs become credits. Sales show the cost adjustment,
and Billing shows the estimated next invoice. The ledger reserves each deduction
or invoice allocation atomically so retries cannot collect it twice.

Reset clears the local example and component tables, including fixture progress.
It does not delete Stripe objects. Keep the same sandbox when resuming; use a new
sandbox when you need an entirely fresh Stripe dataset. Fixture actions reject
live-mode secret keys.

To verify a complete reset and reseed in a disposable sandbox, with the local
app running, use the explicitly destructive opt-in test:

```sh
E2E_LIVE_BACKEND=1 E2E_RESET_SANDBOX=1 pnpm exec playwright test e2e/sandbox-reset-reseed.spec.ts --workers=1
```

The test checks test mode before clearing data, waits for automatic population,
and reruns the seed to check that personas and completed fixture work are not
duplicated. It records a video and a completion screenshot in the test output.

Dispute responses use platform Stripe requests for the example's platform
charges, with the seller passed separately for authorization. Resolved and
under-review disputes are read-only. Customer communication prose is appended
to text evidence; Stripe `file_` IDs are sent as file evidence. The UI confirms
success only after Stripe accepts the draft or submission.

The live dispute browser test consumes one open dispute. After a fresh seed,
run it with `E2E_LIVE_BACKEND=1 pnpm exec playwright test e2e/seller-disputes.spec.ts`.
To exercise partial and remaining-balance refunds on a disposable settled sale,
add `E2E_REFUND_SANDBOX=1` when running `e2e/refunds-reversals.spec.ts`.

### Seller balance-funded billing

Billing sits below Account in the seller sidebar. Account combines details,
onboarding, and Accounts v2 configuration. Existing onboarding and marketplace
account URLs redirect to the corresponding Account section.

Under Billing → Payment source, a seller with a subscription can authorize
recurring platform charges from their available Stripe earnings. The example
creates a `stripe_balance` payment method using the preview API, attaches it to
the seller's `customer_account`, and sets that method explicitly on the existing
store subscription. This bypasses Checkout's dynamic payment method selection.
Opting out restores the previous subscription payment method and method types.
Consent is recorded, and a rejected Stripe request does not mark the option enabled.

Balance Pay requires Stripe's Accounts v2 preview and an eligible connected
account. Insufficient available balance leaves the invoice unpaid. Stripe's
recovery settings determine whether the subscription stays open for retries or
is canceled. Paying an invoice after cancellation does not reactivate the store
plan. Configure those settings before relying on retry-based recovery.

Stripe also supports retrying the same invoice with a different payment method,
including an authorized saved card. Automatic card fallback is not implemented
in this example. See [Stripe's Balance Pay guide](https://docs.stripe.com/payments/pay-with-balance#manually-retrying).

Billing's invoice estimate combines Stripe's upcoming invoice preview with
unrecovered refund/dispute costs and credits. It excludes costs already reserved
for an invoice or deducted from earnings. Refund and dispute itemizations are
under their respective menu pages, with links from estimated adjustment lines.

### Recovery ledger cutover

The package exposes an explicit opening-collection import for preserving costs
already collected by an earlier host ledger. The example's internal
`recoveryMigration.adoptLegacy` adapter checks the original seller/source binding,
uses a stable import identity, and compares the captured legacy observation before
writing. Invoice holds and pending legacy payouts with cost recovery must be
resolved before adoption. Replays preserve the opening snapshot after newer
observations. The normal sale and invoice actions verify and adopt eligible
legacy rows before opening a new recovery boundary; unresolved old outcomes
fail closed and require reconciliation.

New sales reserve package claims in bounded batches before fixing the transfer
allocation. Verified settlement collects those reservations, including after
provider or host write retries. A provider attempt that may have sent money
keeps its reservation; cancellation releases only allocations whose attempt
has never started. A pending invoice or other sale can hold recovery while a
new sale pays the seller without an additional recovery deduction. This lets
new earnings fund a retry of an insufficient-balance invoice. A later plan
invoice likewise defers recovery while another boundary owns the reservation;
the normal monthly plan can still bill without charging the held cost twice.

Monthly invoice adjustments use the package's complete invoice scan and stable
item identity. Paid invoices collect; void invoices release; unpaid or unknown
outcomes stay reserved. Source changes create signed outstanding credits or
costs without rewriting a held boundary. Cost tables read package balances and
distinguish collected from reserved amounts; invoice estimates use the exact
maintained currency balance, with an additional-adjustments line when bounded
history cannot itemize every obligation.

The host keeps source/display metadata and the approved non-refundable fee
policy. The old invoice claiming and payout allocation implementations are
removed. Do not run an older example backend concurrently with this cutover.
Run the combined sandbox renewal acceptance below after changing these flows.
Returned recovery-funding invoices route to the package's verified funding
rollback. The original monthly charge, provider fee and recovery allocation stay
fixed: partial returns reinstate only the corresponding recovery, and uncovered
processing/dispute costs become separate seller obligations. Ambiguous funding
allocations fail closed until the host supplies a verified allocation.

### Testing monthly renewals

Run `pnpm run e2e:balance-renewals` from the example directory. The script creates
isolated sellers with Stripe test clocks, paid monthly plans, actual refund and
dispute costs, and balance payment consent. It advances monthly invoices and
checks both sufficient and insufficient earned balances. It also retries the
same unpaid invoice after earnings arrive and verifies that costs are collected
once. If Stripe canceled the subscription on failure, the report records that
paying the debt leaves store access closed. It does not claim to reactivate a
canceled subscription.

Fixture purchases create seller-owned products and prices and retain their IDs
on the payment. An immediate test dispute can precede settlement. Cost
reconciliation binds that source to the seller's catalog, or to the original
price on its verified paid subscription invoice, without creating a settled sale
or transferring disputed funds. Unreturned principal retained by the platform
first offsets processing costs; actual remaining processing and dispute costs
become seller liabilities. Invoice customer, payment, currency and allocation
checks also apply when the PaymentIntent has no store metadata.

Stripe may activate test recipient capabilities or report processing fees
asynchronously. Retry the same fixture operation with its durable keys instead
of creating replacement payments. Historical prices remain valid source bindings
after catalog deactivation or a subscription price change.

The test refreshes webhook event subscriptions before starting. It cancels each
test subscription afterward, hides these test sellers from the persona picker,
and saves evidence under `qa/2026-10-13/`. All charges are sandbox-only. Stripe
objects remain available for inspection.

## Compare integration styles

The example uses the public `@fantastic.dev/better-stripe/react` workflows for
checkout, payouts, onboarding, accounts, refunds, disputes, product management,
subscriptions, billing, payment methods, referrals, earnings, and admin setup.
The example binds Convex queries/actions and supplies shadcn renderers. Package
consumers can use the same workflows with native unstyled markup or their own
UI, without copying the example's controllers or providers. See
[the React workflow guide](../docs/react-workflows.md) for imports and contracts,
and [the page audit](../docs/react-workflows-audit.md) for the complete mapping.

The example is a developer reference. Supported workflows expose a presentation
switch without changing the active persona, store, referral code, or account:

| Workflow                              | via API example                                             | Package components                  | Stripe UI alternative                                          |
| ------------------------------------- | ----------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------- |
| Seller and affiliate earnings         | Custom earnings cards and ledger                            | `EarningsSummary`                   | Connect Balances                                               |
| Seller and affiliate payouts          | Live balances, upcoming payouts, paginated history          | `PayoutSchedule`                    | Connect Payouts                                                |
| Seller sales                          | Platform sale ledger and actual fee breakdown               | `Sales`                             | Connect Payments for connected-account charges                 |
| Seller refunds                        | API refund controls and seller cost recovery                | `Refunds`, `RefundHistory`          | Refund management in Connect Payments                          |
| Seller disputes                       | `DisputesList`, `DisputeDetail`, and `EvidenceForm`         | Used by the headless view           | Connect Disputes List                                          |
| Seller Account → Details              | API account details                                         | Account helpers and requirements    | Connect Account Management                                     |
| Seller Account → Setup                | API-backed onboarding controls                              | Account onboarding helpers          | Connect Account Onboarding                                     |
| Seller Account → Stripe settings      | API configuration controls                                  | Account configuration controls      | Connect Notification Banner                                    |
| Seller/admin products                 | API catalog management                                      | `PriceCard` render props            | No Connect product catalog embed                               |
| Seller/customer/admin subscriptions   | API subscriber and subscription controls                    | `SubscriptionCard`                  | Hosted Billing Portal for the customer or seller's own billing |
| Customer invoices and payment methods | API-backed lists and controls                               | Existing billing/payment components | Hosted Billing Portal                                          |
| Seller billing                        | Store plan, invoice estimate, balance-payment authorization | Existing plan and payment controls  | Hosted Billing Portal                                          |

Use `?example=headless`, `?example=components`, `?example=embedded`, or
`?example=hosted` for the modes available on a page. Only the active implementation
mounts. Account Session creation resolves the account from the selected persona
on the server and enables only the requested component. Affiliates cannot request
seller payment, refund, or dispute features. Switching stores or themes recreates
the embedded provider for the correct account and appearance.

The marketplace uses **separate charges and transfers**: the platform owns the
charge and transfers earnings to seller and affiliate accounts. Connect Payments
and Disputes show connected-account charges and supported destination charges;
they do not turn the platform's separate-charge ledger into seller-owned charges.
Use via API to manage those marketplace purchases. The embedded example explains
this boundary and reports account/session eligibility errors with a Retry action.
Do not compare an empty connected-account payment list with the platform ledger
as though they were the same dataset.

Products and subscription catalogs have no Connect embedded management component.
The BetterStripe components views demonstrate the package's compact React displays against the same
catalog and subscription data. Customer Subscriptions uses the same layout,
current plan, lifecycle controls, billing portal, and recent invoices in both tabs.
The via API view calls `useSubscriptionManager`; BetterStripe components renders `SubscriptionManager`
with the shared styled render function. Both use the package's validation and
pending/error handling. Seller/admin subscription actions and catalog mutations
remain in via API. The Billing Portal is a separate Stripe-hosted page, not an iframe.
See [Stripe's supported Connect embeds](https://docs.stripe.com/connect/supported-embedded-components?platform=web).

Affiliate Referral earnings also shares its four metric cards, commission
explanation, account details, and loading/zero states between via API and
BetterStripe components. The latter uses `EarningsSummary` render props for populated earnings;
`Earnings` supplies the shared metrics and loading/zero presentation.

Seller Earnings uses the same styled `EarningsSummary`, `PayoutSchedule`, and
`PayoutHistory` in via API and BetterStripe components. Both tabs read the selected store's
recipient balance and payouts, rather than substituting transfer-ledger totals.

The integration tabs distinguish UI ownership: **via API** uses BetterStripe
hooks and API-backed workflows with app-rendered UI; **BetterStripe components**
uses the package's React components, styled by the example app. **Stripe embedded**
and **Stripe hosted** use Stripe's UI. Existing `example=headless` links and the
`headless` package mode value remain compatible; only the visible name changed.

Affiliate Referred sales uses server-side cursor pagination with 10 rows per
page, newest first. Previous/Next controls use the package's `Pagination` and
`useCursorPagination`; changing affiliate accounts resets the cursor history.
`paginateAffiliateSales` enriches each page with store names and commissions after
reversals. It reads `paginateTransfersByAccount`, so older sales remain reachable
beyond the bounded earnings preview.

Affiliate and seller Payouts share the same card layout in via API and
BetterStripe components: Available, Pending, Next payout, Upcoming payouts, and
Previous payouts. Both use the package's `Payouts` workflow and `PayoutHistory`
with the example's styled render props, including Refresh and Load more actions.

### Choose a checkout type

Open any seller product's checkout to compare these integrations. Each option
shows its API, pros, cons, and official documentation before the payment form.
`Stripe.js` is the browser SDK initialized with a publishable key; it is not a
separate server-side payment API. Secret keys stay in the Convex backend.

| Checkout type                       | Backend and frontend                                                                               | Advantages                                                                                              | Tradeoffs                                                                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Hosted Checkout                     | Checkout Sessions with a redirect to Stripe                                                        | Low maintenance; complete checkout and subscription UI                                                  | Redirects away from the app; limited layout control                                                                   |
| Embedded Checkout                   | Checkout Sessions `uiMode: "embedded"` → `embedded_page`; package `EmbeddedCheckout`               | Complete Stripe checkout inside the app                                                                 | Stripe controls the checkout form layout                                                                              |
| Payment Element + Checkout Sessions | `uiMode: "custom"` → `elements`; `CheckoutSessionProvider`, `PaymentElement`, `useCheckoutSession` | Custom page with Checkout Session orchestration; Stripe's recommended custom integration for most cases | App supplies order summary, contact fields, confirmation controls, and error UI                                       |
| Payment Element + Payment Intents   | Payment Intents API; `StripeProvider`, Stripe.js Elements and `confirmPayment`                     | Lower-level control of payment lifecycle and capture                                                    | App owns pricing, tax, shipping, discounts, and subscription orchestration; this example accepts one-time prices only |
| Embedded Checkout Form              | `uiMode: "form"`; Stripe `CheckoutFormProvider` and `CheckoutForm`                                 | Compact prebuilt form with Appearance API customization                                                 | Public preview; availability may differ by sandbox                                                                    |

Deep-link a checkout with
`?priceId=<price>&ref=avery&checkout=redirect|embedded|custom|payment-intent|form`.
Switching types preserves the product and referral attribution. Each type creates
its own Stripe session or intent; switching does not confirm a payment. Hosted
Checkout opens only when you choose Continue to Stripe Checkout.

The Payment Intent action reads the price and store eligibility from the server,
rejects recurring or inactive prices, uses a stable per-attempt idempotency key,
and writes the same store/affiliate metadata as Checkout Sessions. Successful
payments go through the same webhook settlement and actual Stripe fee accounting.
Receipts use server-side webhook state, including `/checkout/status?payment_intent=pi_…`
for Payment Intent purchases. A bare PaymentIntent does not create a recurring
subscription, so choose one of the Checkout Session flows for recurring products.

Connect embedded components manage connected accounts; they do not provide a
shopper checkout. Wallet buttons and Payment Links are additional payment entry
points rather than different APIs demonstrated by this chooser. See
[Stripe Checkout](https://docs.stripe.com/payments/checkout),
[Payment Element](https://docs.stripe.com/payments/payment-element), and
[Payment Intents](https://docs.stripe.com/payments/payment-intents).

### Test the integration examples

After sandbox setup and fixture seeding, run the opt-in browser checks from
`example/` with the app running:

```sh
E2E_LIVE_BACKEND=1 pnpm exec playwright test \
  e2e/integration-examples.spec.ts e2e/checkout-methods.spec.ts \
  e2e/checkout-failures.spec.ts --workers=1
```

The checkout checks create real Stripe sandbox purchases for all five types,
including guest referral attribution. They wait for webhook confirmation and
verify settled seller and affiliate transfers and that actual Stripe fees,
platform revenue, commissions, seller earnings, and recovered costs reconcile.
These purchases remain in your sandbox. Checkout runs in a normal browser and
records video; use `E2E_PORT` when your dev server uses a different port. The
component checks initialize each scoped Stripe embed and exercise the checkout
chooser. They do not submit refunds or dispute evidence.

The failure checks use a normal browser and Stripe's documented test cards:

| Scenario                | Test card             | Expected behavior                                             |
| ----------------------- | --------------------- | ------------------------------------------------------------- |
| Visa success            | `4242 4242 4242 4242` | Confirm payment and settle the seller/affiliate split         |
| Mastercard success      | `5555 5555 5555 4444` | Complete a custom Checkout retry                              |
| Decline                 | `4000 0000 0000 0002` | Display the error, then allow retry with a good card          |
| Insufficient funds      | `4000 0000 0000 9995` | Display the decline without completing checkout               |
| Expired card            | `4000 0000 0000 0069` | Display the expired-card error and allow retry                |
| Incorrect CVC           | `4000 0000 0000 0127` | Display the security-code error and allow retry               |
| 3D Secure completion    | `4000 0084 0000 0027` | Complete the authentication challenge                         |
| 3D Secure cancellation  | `4000 0000 0000 3220` | Cancel the challenge, then retry with a good card             |
| Decline after 3D Secure | `4000 0084 0000 1629` | Complete authentication, display the decline, and allow retry |

Use a future expiry such as `12/34` and a three-digit CVC in the browser.
Do not submit raw card numbers through server APIs; use Stripe's test
PaymentMethod IDs for server-side fixtures. Read [Stripe's testing overview](https://docs.stripe.com/testing/overview),
[test card guide](https://docs.stripe.com/testing), and [Billing testing guide](https://docs.stripe.com/billing/testing)
for additional cases such as asynchronous refunds, disputes, and renewal test clocks.

Custom Checkout treats a session-provided email as read-only. A guest without a
session email can enter one and edit it after a failed payment. Affiliate
earnings previews show the newest 50 transfers; aggregate totals still include
the complete ledger.

### Configure store-plan pricing

As Admin, open **Store plans** to set Starter, Growth, and Pro monthly USD prices
and sale fee percentages. The defaults remain $9/9%, $49/4.9%, and $99/Stripe
processing only. Leave the sale fee blank for processing only. All sale fees keep
the processing-cost floor, so the platform never absorbs Stripe processing.

Saving a monthly-price change creates a new immutable Stripe monthly Price for
future subscriptions. Existing subscribers keep their existing monthly Price,
including at renewal. Their previous prices remain active and recognized by the
billing webhook. Sale fee changes apply to future settlements; settled sales
keep their recorded economics. The seller Billing cards read the saved pricing.
Admin updates reject invalid amounts, non-admin personas, and stale versions.

The reusable unstyled `PlanPricingEditor` in `better-stripe/react` owns decimal
input validation and save/pending/error handling; the example supplies table,
input, and button styling. The example backend authorizes the admin persona,
creates the Stripe Price, and publishes catalog and fee settings atomically.
Like the rest of this demo, personas use mock users rather than production auth.

Each Store plans row has a separate affiliate payout editor for percentages or
fixed amounts. Unconfigured payouts default to 0%. Payout-only edits keep
the monthly Stripe Price and subscriptions unchanged. Future settlements resolve
the seller's price, product, and plan defaults; settled sales and refunds retain
the original amounts.

### Seller product and subscription affiliate payouts

Seller → Products shows an inline affiliate payout editor on each product and
expanded price row, including recurring subscription prices. The BetterStripe
components tab also includes the inline editor on each price card. Enter a number,
choose `%` or the price currency symbol, then Save. X clears and saves inheritance;
zero explicitly disables the payout. Admin → Store plans uses the same editor for
plan defaults. Clearing a plan override inherits the global payout, or 0% if unset.

Price overrides win over product defaults, then the store-wide payout, store-plan override, and platform-wide payout. With no configured rule, the payout is 0%. Percentages
apply after the inclusive sale fee. Fixed amounts use major units of the sale's
currency: 5 means USD 5 on a USD price or EUR 5 on a EUR price. Product and plan
defaults use that same nominal amount in each sale currency, without currency
conversion. Fixed amounts are capped at the proceeds after fees, so seller
proceeds cannot go negative. Fractions below a currency's minor unit round down.
Stripe processing is always covered by the seller.

Payout amount changes apply to future purchases and subscription renewals. Commission
term changes apply to new subscriptions only. Settled sales retain
the recorded rule, source, product/price IDs, and splits. Subscription settlement
uses the current Stripe subscription price rather than stale checkout metadata.
Legacy payments without product metadata inherit the plan default. The backend
checks product ownership, integer percentage basis points, non-negative fixed
amounts with up to two decimals, and edit versions. This example uses selectable
mock personas; production apps must derive authorization from authenticated users.

The unstyled `AffiliatePayoutEditor` in `better-stripe/react` owns the input,
mode toggle, validation, Save/Clear actions, and feedback. The example supplies
its design-system markup with the render prop. `AffiliateRateEditor` remains
available for percentage-only forms.

### Optional affiliate defaults

Seller → Products has an optional store-wide affiliate payout. Admin → Store plans
has an optional platform-wide payout and inline overrides for each plan. All start
unset. The effective fallback is zero, including for referred purchases. Explicit
zero disables payouts even when a parent setting is configured. Clear removes the
override and restores inheritance, rather than restoring a built-in percentage.
The admin plan catalog uses rows with status, monthly price, sale fee, affiliate
payout, and Save pricing actions. Affiliate Save and Clear remain independent of
monthly price edits; existing store subscriptions retain their monthly prices.

### Affiliate commission regression checks

With a seeded Stripe sandbox and the example running on localhost:5173, run:

```sh
E2E_LIVE_BACKEND=1 pnpm exec playwright test e2e/affiliate-commissions.spec.ts --workers=1
```

Run this from `example/`. It checks every available store's copied referral link,
Visitor/Customer attribution, percentage overrides at global/store/product/price
scope, invalid and missing referrals, explicit zero, and capped fixed payouts.
It completes real sandbox payments and checks the settlement and transfer ledger.
Temporary payout rules are restored in cleanup; sandbox transactions remain.
Stores whose Stripe recipient capabilities are not active are correctly excluded.
Use `e2e/checkout-methods.spec.ts` to cover all five checkout presentations and
`e2e/seller-affiliate-rates.spec.ts` for fixed product/subscription price payouts.

### Affiliate commission terms

The reusable `AffiliatePayoutEditor` supports **Forever**, **One-time**, and an
inherited term alongside percentage or fixed payouts. Terms inherit from price →
product → store → plan → platform; the fallback is Forever for compatibility.
An explicit 0% still disables commissions.

Subscription Checkout saves the resolved `affiliateCommissionTerm` in Stripe
subscription metadata. The example also stores the term and first successfully
paid invoice in `subscriptionCommissions`, indexed by Stripe subscription ID.
One-time pays commission on that invoice only; Forever pays again on renewals.
Failed payments do not consume the first commission, and settlement retries reuse
the recorded amounts. Term changes apply to new subscriptions; existing
subscriptions retain their saved term. Older subscriptions without a term retain
Forever. Payout amounts still resolve from the current price/product settings on
each invoice. Refunds follow the existing commission reversal rules and do not
reset the first invoice. One-time purchases have only one commission regardless
of the selected subscription term.

Run the subscription-term browser checks from `example/`:

```sh
E2E_LIVE_BACKEND=1 E2E_HEADLESS=1 pnpm exec playwright test e2e/affiliate-terms.spec.ts --workers=1
```

These checks configure both terms, complete real subscription checkouts, verify
the first paid invoice's ledger, and check the controls in via API, BetterStripe
components, and admin views. They restore temporary rules; sandbox subscriptions
and transactions remain. They do not advance a billing cycle.

For renewal verification, use [Stripe test clocks](https://docs.stripe.com/billing/testing/test-clocks)
with a sandbox customer and subscription carrying the same seller, price,
affiliate, `storeBilling`, and `affiliateCommissionTerm` metadata as Checkout.
Keep a nonzero payout rule configured during the test. Wait for the first invoice
to settle, then advance the clock through the next billing period and await the
paid-invoice webhook. Forever must create another affiliate transfer; One-time
must create none and retain those proceeds in the seller transfer. Verify actual
Stripe fees and all transfer amounts, then restore the payout settings. Failed
payments must create no commission, and retries must not duplicate transfers.

The first One-time settlement checks Stripe's paid invoice history, skipping
zero-dollar invoices, so out-of-order webhooks cannot award a renewal the first
commission. Once stored, the database claim identifies that invoice on later
settlements. An unclaimed One-time subscription with more than 100 paid invoices
requires review instead of guessing; existing subscriptions without a term keep
Forever.

### Affiliate clawback accounting and migration

The package records original affiliate commission obligations across successful
refunds and monetary disputes. Recovery uses the original transfer amount and
currency for each charge/invoice, with cumulative refund targets, shared dispute
exposure, and exact reversal receipts. Pending and failed refunds do not finalize
commission recovery.

After deploying the additive component schema, an authenticated operator wrapper
can call `components.betterStripe.settlement.mutations.migrateAffiliateObligations`
with `{ paginationOpts: { numItems: 100, cursor: null } }`. Continue with each
returned `continueCursor` until `isDone`; repeated pages are safe. Review `skipped`
rows and `needsReconciliation` flags against original allocations and provider
receipts. This is separate from the subscription-term migration above.

Use `components.betterStripe.settlement.queries.listAffiliateObligations` from a
host query that derives the affiliate account from the authenticated caller and
passes a currency and pagination options. The earnings, referred-sales and affiliate payout screens include the reusable
recovery view. Snapshots show debt, withheld/reserved earnings, original
commissions, reversals and restoration separately. Debt offsets run before
future commission transfers; dispute wins retain independent refunds.

These live endpoints require an authenticated identity whose `tokenIdentifier`
is provisioned as `users.authTokenIdentifier`. Configure a trusted JWT issuer in
`convex/auth.config.ts` and connect its tokens to the frontend Convex client
before exercising live recovery views; this example has no issuer configured. The existing demo persona picker
is not authentication and grants no recovery access. `/admin/affiliate-recovery`
requires the server-linked user's admin role for retries and another affiliate's
records. `/demo/affiliate-recovery` needs no live account and labels all ten
scenario snapshots as simulated. Internal cron jobs reconcile pending/unknown
recovery and payout operations every five minutes, one operation per invocation.

The existing sandbox/browser checks do not establish recovery from a completed
bank payout. Verify supported Connect account capabilities and actual Stripe
receipts before claiming live recovery; do not route Global Payouts through
Connect reversal APIs. See the [full recovery guide](../docs/affiliate-clawbacks.md)
for field meanings, bounds, webhook subscriptions, migration and rollout limits.

The internal `affiliateRecoverySandbox:seed` action creates actual test-mode
payment/refund fixtures using a stable run key and existing Connect recipients.
It supports full/partial refunds, dispute-producing cards, recurring invoice
sources, future commissions and verification of an actual completed test payout.
See the [sandbox scenario driver](../docs/affiliate-clawbacks.md#stripe-sandbox-scenario-driver)
for commands, account prerequisites, receipt assertions and blocked-capability
handling. The [UI recording](../docs/evidence/affiliate-recovery.webm) shows
simulated fixtures, not live provider evidence.
The Payment Intent checkout adapter now delegates creation to the public
`BetterStripe.createPaymentIntent` API after resolving the demo customer, store,
price and referral context. It preserves sale settlement metadata, guest
purchases and stable request keys. Amount/currency validation also occurs against
Stripe's live platform price. Demo personas are not production authentication.

For saved cards, use the exported unstyled `SaveCard` workflow with an authorized
`createSetupIntent` server callback. The demo's existing tokenization/attach
screen remains compatible and does not demonstrate completed SetupIntent/SCA
verification. See the [setup workflow contract](../docs/react-workflows.md#save-a-card-through-setupintent-confirmation)
for consent, redirect recovery and durable request requirements.

### Live saved-card verification, 2026-10-15

A separate temporary browser fixture exercised the public `SaveCard` component
and intent APIs against a Connect-enabled Stripe sandbox. Real 3DS failure,
retry on the same SetupIntent, successful setup and a later off-session saved-card
payment passed. The later payment was refunded and test fixtures cleaned up.
This does not turn the demo's tokenization/attach screen into a SetupIntent flow
or prove production host authentication.

See the [authentication and reuse results](../docs/react-workflows.md#live-authentication-and-reuse-results-2026-10-15),
[sandbox setup findings](../docs/accounts-v2-preview.md#connect-sandbox-setup-findings-2026-10-15),
and [uploaded evidence](https://github.com/FantasticDevHQ/better-stripe/pull/166#issuecomment-6185124292).

## Component history and currency summaries

See the [read contract guide](../docs/read-contracts.md) for reactive product, price and payout
cursors, exact currency summaries, legacy backfill, payout failure details, and
published-version adoption requirements.
