# Changelog

## Unreleased

- Return every original split leg by default from `listTransfersByCharge`,
  excluding reinstatement rows before applying any explicit preview limit.
  Split breakdowns and reversal claims now cover sales with more than 50 legs.
  Queries and atomic claims fail on Convex resource limits rather than silently
  truncate financial data. `listTransfersByAccount` remains a preview API;
  earnings hooks use exact server-side aggregates.
- Update the former roadmap to describe the existing product-level first-charge
  descriptors, first-invoice fee recovery, retry-safe reversal claims, and exact
  earnings aggregates, including their practical limitations.
- Remove internal tracker references from public documentation and add a
  regression check that prevents their reintroduction.

## [0.20.1](https://github.com/FantasticDevHQ/better-stripe/compare/v0.20.0...v0.20.1) (2026-10-15)

### Documentation

- record live saved-card verification and sandbox setup ([#178](https://github.com/FantasticDevHQ/better-stripe/issues/178)) ([18d8b30](https://github.com/FantasticDevHQ/better-stripe/commit/18d8b30cd739c90e68508bd4d119297dc219da5c))

## [0.20.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.19.0...v0.20.0) (2026-10-15)

### Features

- **payouts:** persist source allocations and payout claims ([#184](https://github.com/FantasticDevHQ/better-stripe/issues/184)) ([e99f99e](https://github.com/FantasticDevHQ/better-stripe/commit/e99f99edbec4d1f81988a7854ad26d6fa7ae8a51))

## [0.19.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.18.0...v0.19.0) (2026-10-15)

### Features

- **payouts:** verify recipient transfer funding receipts ([#182](https://github.com/FantasticDevHQ/better-stripe/issues/182)) ([e93d0a7](https://github.com/FantasticDevHQ/better-stripe/commit/e93d0a7a36245b20d568f8c2a3fe117a7f63ea8c))

## [0.18.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.17.1...v0.18.0) (2026-10-15)

### Features

- **payouts:** add durable recipient-held policy controls ([#180](https://github.com/FantasticDevHQ/better-stripe/issues/180)) ([14404c6](https://github.com/FantasticDevHQ/better-stripe/commit/14404c6d3a710c214917657baeb807c180eb1b0f))

## [0.17.1](https://github.com/FantasticDevHQ/better-stripe/compare/v0.17.0...v0.17.1) (2026-10-15)

### Bug Fixes

- **ci:** retry release auto-merge on stale head rejection ([#176](https://github.com/FantasticDevHQ/better-stripe/issues/176)) ([a52cbe8](https://github.com/FantasticDevHQ/better-stripe/commit/a52cbe84480ee1fc804240b04a1200468ca57100))
- **earnings:** reject unsafe currency summary arithmetic ([#175](https://github.com/FantasticDevHQ/better-stripe/issues/175)) ([52b6db6](https://github.com/FantasticDevHQ/better-stripe/commit/52b6db6074dc45a7f1d8b2d5f8c62ce3e2261ee8))

### Documentation

- explain evidence uploads, navigation guards and release auto-merge ([#177](https://github.com/FantasticDevHQ/better-stripe/issues/177)) ([a089e78](https://github.com/FantasticDevHQ/better-stripe/commit/a089e78dc6c04a15cb87b1488dd9eecf8cd7fa45))

## [0.17.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.16.0...v0.17.0) (2026-10-15)

### Features

- **refunds:** expose authoritative cursor history ([#172](https://github.com/FantasticDevHQ/better-stripe/issues/172)) ([5943471](https://github.com/FantasticDevHQ/better-stripe/commit/5943471c406d9202e69691eabbdc1839d5b2b5a3))

### Bug Fixes

- **example:** route seller recovery through verified package ledgers ([#173](https://github.com/FantasticDevHQ/better-stripe/issues/173)) ([f361f2e](https://github.com/FantasticDevHQ/better-stripe/commit/f361f2eb7ba46d98898e928b8bcfe7ef3f42150d))

## [0.16.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.15.0...v0.16.0) (2026-10-15)

### Features

- **reads:** currency summaries and reactive cursor contracts ([#170](https://github.com/FantasticDevHQ/better-stripe/issues/170)) ([5ac85e5](https://github.com/FantasticDevHQ/better-stripe/commit/5ac85e59f1769b6485378971d64888d3f7009c1e))

## [0.15.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.14.0...v0.15.0) (2026-10-15)

### Features

- provision payment and saved-card setup intents ([#166](https://github.com/FantasticDevHQ/better-stripe/issues/166)) ([195e4c6](https://github.com/FantasticDevHQ/better-stripe/commit/195e4c630e6f70907405fd9c8aa0d9cfcf17e6d5))

## [0.14.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.13.0...v0.14.0) (2026-10-15)

### Features

- bind dispute evidence uploads and guard onboarding navigation ([#167](https://github.com/FantasticDevHQ/better-stripe/issues/167)) ([e52cd5d](https://github.com/FantasticDevHQ/better-stripe/commit/e52cd5dfc34d3c83a00d2f1686d07af5370b1e60))
- **recovery:** preserve verified opening collections ([#163](https://github.com/FantasticDevHQ/better-stripe/issues/163)) ([e613ac0](https://github.com/FantasticDevHQ/better-stripe/commit/e613ac0d52d1d053b4e3a54dd0394ad1e427c729))

### Bug Fixes

- **recovery:** release unbound void invoice reservations ([#165](https://github.com/FantasticDevHQ/better-stripe/issues/165)) ([a73fd89](https://github.com/FantasticDevHQ/better-stripe/commit/a73fd893370688385fcf9dc2a8dd309d2cbd3ead))

## [0.13.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.12.0...v0.13.0) (2026-10-15)

### Features

- **recovery:** reconcile seller cost invoice adjustments ([#159](https://github.com/FantasticDevHQ/better-stripe/issues/159)) ([d1ffdbc](https://github.com/FantasticDevHQ/better-stripe/commit/d1ffdbcb224b6c31ae958c576a4bcd6ff4a0a4dd))

### Bug Fixes

- **example:** bind reversal inputs to original charge currency ([#160](https://github.com/FantasticDevHQ/better-stripe/issues/160)) ([6b86926](https://github.com/FantasticDevHQ/better-stripe/commit/6b86926c7d4a173babd2964d4eee086f61c48f63))
- **example:** reconcile unsettled disputed sources ([#161](https://github.com/FantasticDevHQ/better-stripe/issues/161)) ([9c732bd](https://github.com/FantasticDevHQ/better-stripe/commit/9c732bdc88555210d2172067e6bbf5d2fc513190))
- **react:** isolate refund preview amounts by currency and status ([#162](https://github.com/FantasticDevHQ/better-stripe/issues/162)) ([601d509](https://github.com/FantasticDevHQ/better-stripe/commit/601d50923dc98f212b29fd4e4e3d856dfffbda44))
- **react:** preserve original refund currency units ([#157](https://github.com/FantasticDevHQ/better-stripe/issues/157)) ([494827f](https://github.com/FantasticDevHQ/better-stripe/commit/494827f1cb35b0b0ca10b1c6da38a1095bb32500))

## [0.12.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.11.0...v0.12.0) (2026-10-15)

### Features

- **billing:** add consented balance funding operations ([#149](https://github.com/FantasticDevHQ/better-stripe/issues/149)) ([16434c4](https://github.com/FantasticDevHQ/better-stripe/commit/16434c4eeef343045b4ba66516221232dfa57e06))
- **billing:** expose complete upcoming invoice previews ([#147](https://github.com/FantasticDevHQ/better-stripe/issues/147)) ([6d81cec](https://github.com/FantasticDevHQ/better-stripe/commit/6d81cec1b458fadbe4aeb69b9611d6ba208d87ce))
- **recovery:** add durable cost claims and reservations ([#151](https://github.com/FantasticDevHQ/better-stripe/issues/151)) ([a958c3a](https://github.com/FantasticDevHQ/better-stripe/commit/a958c3aa12178de4f22c0c614b0b9e5d7eb37819))
- **settlement:** expose complete processing cost context ([#150](https://github.com/FantasticDevHQ/better-stripe/issues/150)) ([3933d6b](https://github.com/FantasticDevHQ/better-stripe/commit/3933d6bf3c54181e8f7c27b35e6eb6802fb7c2d8))

### Bug Fixes

- **react:** preserve charge currency units in price cards ([#155](https://github.com/FantasticDevHQ/better-stripe/issues/155)) ([b0967ae](https://github.com/FantasticDevHQ/better-stripe/commit/b0967ae61ac8ae85adc4f2d8f375e2c71ad1464f))
- **react:** preserve plan pricing currency units ([#156](https://github.com/FantasticDevHQ/better-stripe/issues/156)) ([f65e712](https://github.com/FantasticDevHQ/better-stripe/commit/f65e712a91dd55e6979ccea540627d4c437dfc6c))
- **release:** keep generated notes public ([#153](https://github.com/FantasticDevHQ/better-stripe/issues/153)) ([d67f21a](https://github.com/FantasticDevHQ/better-stripe/commit/d67f21a6315c0498db7358b6b37669520037fefa))
- **release:** preserve historical code examples ([#154](https://github.com/FantasticDevHQ/better-stripe/issues/154)) ([1c3c9f0](https://github.com/FantasticDevHQ/better-stripe/commit/1c3c9f0a63e7c5eb77e685dc0bb3963a4e7dc935))
- **webhooks:** reconcile dedicated payout cancellations ([#152](https://github.com/FantasticDevHQ/better-stripe/issues/152)) ([9dd84e2](https://github.com/FantasticDevHQ/better-stripe/commit/9dd84e22473a35445a0445a82e8fcdf2eb9ace23))

## [0.11.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.10.2...v0.11.0) (2026-10-14)

### Features

- add retry-safe catalog creation request keys ([#145](https://github.com/FantasticDevHQ/better-stripe/issues/145)) ([45b0d52](https://github.com/FantasticDevHQ/better-stripe/commit/45b0d52dfcb6577cf5df339721ed9eed34a83a1d))

## [0.10.2](https://github.com/FantasticDevHQ/better-stripe/compare/v0.10.1...v0.10.2) (2026-10-14)

### Bug Fixes

- sync portal cancellations and clarify preview setup ([#143](https://github.com/FantasticDevHQ/better-stripe/issues/143)) ([62998ae](https://github.com/FantasticDevHQ/better-stripe/commit/62998aed54946711619a3af82ad44b6cf8406abc))

## [0.10.1](https://github.com/FantasticDevHQ/better-stripe/compare/v0.10.0...v0.10.1) (2026-10-14)

### Bug Fixes

- support customer-only Accounts v2 preview configuration ([#141](https://github.com/FantasticDevHQ/better-stripe/issues/141)) ([e58905d](https://github.com/FantasticDevHQ/better-stripe/commit/e58905d1c588995cac55ae0f5b830f785ff65f75))

## [0.10.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.9.0...v0.10.0) (2026-10-14)

### Features

- expose reusable settlement, payouts, and resilient billing APIs ([#139](https://github.com/FantasticDevHQ/better-stripe/issues/139)) ([a88e9ea](https://github.com/FantasticDevHQ/better-stripe/commit/a88e9eae5aa12e32c108ea16c19f5b6e8870f7e4))

## [0.9.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.8.1...v0.9.0) (2026-10-14)

### Features

- configure store pricing and affiliate commissions ([#137](https://github.com/FantasticDevHQ/better-stripe/issues/137)) ([aa7181e](https://github.com/FantasticDevHQ/better-stripe/commit/aa7181ecc23b5c38f3eb0f6480399cf5736332f6))

## [0.8.1](https://github.com/FantasticDevHQ/better-stripe/compare/v0.8.0...v0.8.1) (2026-10-13)

### Bug Fixes

- harden sandbox example and reusable React workflows ([#135](https://github.com/FantasticDevHQ/better-stripe/issues/135)) ([65985a5](https://github.com/FantasticDevHQ/better-stripe/commit/65985a5be392e3bcb04c4055fb36515ba02de0b2))

## [0.8.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.7.0...v0.8.0) (2026-10-13)

### Features

- compare checkout and embedded integration examples ([#133](https://github.com/FantasticDevHQ/better-stripe/issues/133)) ([0d916f6](https://github.com/FantasticDevHQ/better-stripe/commit/0d916f6aecf734877da379327a3148753fc0c4c3))
- ship reusable React workflows and migrate the example UI ([#134](https://github.com/FantasticDevHQ/better-stripe/issues/134)) ([a1336ce](https://github.com/FantasticDevHQ/better-stripe/commit/a1336ced2a6d3a09210e769a89cf70022c0f7531))

### Maintenance

- add repo-gates and enforce check:all ([#131](https://github.com/FantasticDevHQ/better-stripe/issues/131)) ([be80b7f](https://github.com/FantasticDevHQ/better-stripe/commit/be80b7f8fe186bc22dbdc956357bd4a1120eec29))

## [0.7.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.6.1...v0.7.0) (2026-10-13)

### Features

- expand marketplace example with seller billing and sandbox fixtures ([#129](https://github.com/FantasticDevHQ/better-stripe/issues/129)) ([7f21f53](https://github.com/FantasticDevHQ/better-stripe/commit/7f21f5365ce82cab9ecc984b94f444408223f8b8))

## [0.6.1](https://github.com/FantasticDevHQ/better-stripe/compare/v0.6.0...v0.6.1) (2026-10-13)

### Bug Fixes

- complete large split reversals and keep public docs current ([#127](https://github.com/FantasticDevHQ/better-stripe/issues/127)) ([e7cc0a9](https://github.com/FantasticDevHQ/better-stripe/commit/e7cc0a9b0ea01f4993447f9d73edebe71b364081))

## [0.6.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.5.0...v0.6.0) (2026-10-12)

### ⚠ BREAKING CHANGES

- the package name changes to @fantastic.dev/better-stripe; @getdojo/better-stripe receives no further releases.

### Features

- complete Stripe Endive compatibility and release 0.5.0 ([#126](https://github.com/FantasticDevHQ/better-stripe/issues/126)) ([135695f](https://github.com/FantasticDevHQ/better-stripe/commit/135695f51906ea156a36dbe8d0d43cf1d99e5fc1))
- publish as [@fantastic](https://github.com/fantastic).dev/better-stripe via Release Please and trusted publishing ([#120](https://github.com/FantasticDevHQ/better-stripe/issues/120)) ([7451eeb](https://github.com/FantasticDevHQ/better-stripe/commit/7451eeb514b09a09656355c74c4bec083e1ddce7))

### Bug Fixes

- repair example checkout billing and seller flows ([#125](https://github.com/FantasticDevHQ/better-stripe/issues/125)) ([5911fb8](https://github.com/FantasticDevHQ/better-stripe/commit/5911fb8d8bc585fab62fe48e58e1e964047b8fd9))

### Maintenance

- **deps:** update dependencies to latest ([#122](https://github.com/FantasticDevHQ/better-stripe/issues/122)) ([a7e4161](https://github.com/FantasticDevHQ/better-stripe/commit/a7e416179d20afdd2356668cbd4482e2e3fa4eff))

### Continuous Integration

- **release:** open release PRs with the org release GitHub App ([#124](https://github.com/FantasticDevHQ/better-stripe/issues/124)) ([3c94f2e](https://github.com/FantasticDevHQ/better-stripe/commit/3c94f2ef317f939ac039c261f9c148e6b1f14a56))

## 0.5.0

### Features

- Incorporate Dojo's `retryOnHookError` webhook patch upstream. Selected,
  signature-verified V1 `onEvent`/event hooks must succeed before acknowledgment;
  failed hooks and unavailable ledger writes return 500, in-flight deliveries
  return 503, and successful redelivery deduplicates. The default remains
  best-effort. Add regression coverage using real SDK signatures and the real
  Convex component ledger, including stale-reservation recovery.

### Bug Fixes

- Complete support for Stripe API **`2026-09-30.endive`** with stripe-node
  **23.0.0** (already pinned in the 0.4.0 checkout). Verify both client factories'
  outgoing version headers against the typed single-source API constant.
- Preserve verified V2 notification context when retrieving accounts; accept
  related-object pointers without an id and resolve accounts from their URL.
- Map Endive `rejected`/`restricted` capabilities to `restricted` and pending
  capabilities to `in_progress`, including nested Stripe balance capabilities.
- Remount embedded Checkout when its key/client secret changes, using React
  Stripe.js 7's current `createEmbeddedCheckoutPage` integration.
- Deprecate the retained, ignored V2 account-link `configurations` option and
  remove its obsolete internal use.

### Migration

See [MIGRATION.md](MIGRATION.md) for removing the Dojo pnpm patch, upgrading
0.2.0 webhook wiring, billing-anchor/payment-method request changes, and
**separate consumer-controlled webhook destination upgrades**. The public
`V2ThinEvent.related_object.id` is now optional; consumers must guard it.
No account defaults, event destinations, DNS, or production deployments are
changed by this release.

## 0.4.0

**Renamed to `@fantastic.dev/better-stripe`.** This is the first release under the new name, published from `FantasticDevHQ/better-stripe` through npm trusted publishing with provenance. `@getdojo/better-stripe` is deprecated and gets no further releases. To migrate, replace `@getdojo/better-stripe` with `@fantastic.dev/better-stripe` in `package.json`, in imports and in `convex.config.ts`, then run `npx convex dev` to regenerate `_generated/`. The API is unchanged by the rename.

`0.3.0` was versioned but never published, so this release also ships everything listed under `0.3.0` below, including its breaking webhook-wiring change.

### Minor Changes

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Add `getAccountBalance` for per-account balance retrieval ([#62](https://github.com/kellykampen/better-stripe/issues/62)).

  New `BetterStripe.getAccountBalance({ stripeAccountId })` reads a connected account's live Stripe balance, scoped via the `Stripe-Account` header (mirroring the other per-account calls like `createPayout`). Pairs Stripe's separate `available`/`pending` per-currency lists into one `AccountBalance` (`{ available, pending, currency }`, minor units) per currency — a currency present on only one side defaults to `0` on the other. `AccountBalance` is re-exported at the package root, and its shape matches the `PayoutSchedule` component's `balance` prop directly.

  Purely additive.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Add headless `BuyerBillingView` component ([#50](https://github.com/kellykampen/better-stripe/issues/50)).

  The buyer's embedded-only, in-app billing surface: shows a buyer's subscriptions grouped by store (via the existing `groupSubscriptionsByStore` util, not recomputed), with per-store cancel/reactivate through the shared `SubscriptionCard`/`SubscriptionActions`, the one saved payment method reusable across every store, and an embedded (no-redirect) card-update slot.

  React-surface only — no server/schema changes, no new dependencies. Full headless convention: `className`, per-label i18n overrides, `children` render-prop, loading/empty states. Purely additive.

- [#22](https://github.com/kellykampen/better-stripe/pull/22) [`ad52d4a`](https://github.com/kellykampen/better-stripe/commit/ad52d4a083d27b1c82f5a043043a988fc60e8fed) Thanks [@kellykampen](https://github.com/kellykampen)! - Add support for the V2 **customer configuration** — the billable entity in the V2 Accounts API, where a single Account with a customer configuration replaces the legacy V1 Customer object.

  - `BetterStripe.addCustomerConfiguration(ctx, { stripeAccountId })` — applies the customer configuration to an existing account (making it usable in customer-facing payment/billing flows: subscriptions, invoices, and the billing portal via `customer_account: acct_…`), re-reads the configurations Stripe actually applied, and records them on the component account. Throws `ACCOUNT_NOT_FOUND` (without touching Stripe) if the account isn't in the component DB. Returns `{ success: true, appliedConfigurations }`.
  - `BetterStripe.DEFAULT_CUSTOMER_CONFIGURATION` — the documented `{ customer: {} }` preset. Request `customer.capabilities.automatic_indirect_tax` separately if you need automatic tax on this account's invoices/subscriptions.

  Previously `DEFAULT_ACCOUNT_CONFIGURATION` only requested the merchant configuration, so there was no first-class path to create a customer-billable account.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Add `DisputeDetail` + `EvidenceForm` headless React components ([#40](https://github.com/kellykampen/better-stripe/issues/40)).

  - `DisputeDetail` — renders a dispute's amount, reason, status, evidence-due countdown message, and linked transfer ids. Loading/empty states, i18n label overrides.
  - `EvidenceForm` — headless controlled form for the four Skool-style evidence fields (product description, access activity, additional info, customer communication); `stage()` saves a draft (no `submit` key), `submit()` finalizes with `submit: true`. Supports `stripeAccountId` scoping and `onStaged`/`onSubmitted`/`onError` callbacks.

  Both are headless/themeable (`className` plus a `children` render-prop) and consume the existing dispute handling/dispute hooks core with no duplicated logic. Purely additive.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Add headless `DisputesList` component with due-by countdown badges ([#41](https://github.com/kellykampen/better-stripe/issues/41)).

  Pure, hook-free presentational list of a seller's disputes, sorted by evidence deadline (soonest first, no-deadline rows last, overdue rows naturally at the top). Rows accept the exact shape `getDisputeWithCountdown`/`useDisputeWithCountdown` produce, so the component never recomputes deadlines itself.

  Headless overrides: `className`, i18n labels (`emptyLabel`, `loadingLabel`, `dueLabel`/`overdueLabel` with `{days}` templating), a per-row `renderRow` slot, and a whole-list `children` render prop. Default markup is semantic `ul[role=list] > li[data-dispute-id]` with a `span[role=status]` badge carrying `data-overdue`. Purely additive.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Add dispute React hooks: `createUseDisputes` + `createUseDisputeWithCountdown` ([#36](https://github.com/kellykampen/better-stripe/issues/36)).

  Two new factory hooks following the existing `createUse*` convention:

  - `createUseDisputes` — wraps `listDisputes` with `account`/`status` filters (list-style, mirrors `createUseInvoices`); returns `{ disputes, isLoading }`.
  - `createUseDisputeWithCountdown` — wraps `getDisputeWithCountdown` for a single dispute id (mirrors `createUseSubscription`); returns `{ dispute, countdown, isLoading }`, using Convex's `"skip"` sentinel when no id is provided.

  Both wired into the `@getdojo/better-stripe/react` entry export; `StripeComponentDispute` re-exported for consumers. Purely additive.

- [#51](https://github.com/kellykampen/better-stripe/pull/51) [`6345352`](https://github.com/kellykampen/better-stripe/commit/6345352cf4b3ad4247c865090693e877da6bf5ef) Thanks [@kellykampen](https://github.com/kellykampen)! - Smart-retry dunning: surface failed subscription cycles.

  `invoice.payment_failed` previously upserted the invoice but fired **no** async hook, so apps couldn't react to a failed subscription cycle. It now schedules a new invoice-level hook:

  - **`AsyncHooks.onInvoicePaymentFailed(ctx, invoice)`** — fires on `invoice.payment_failed` (mapped to the internal `afterInvoicePaymentFailed` hook). This is the invoice-level (subscription-cycle) failure, distinct from `onPaymentFailed`, which fires on a one-time **PaymentIntent** failure and receives a payment, not an invoice. The delinquency transition itself (`past_due` → `unpaid`) still arrives via `customer.subscription.updated` → `onSubscriptionUpdated`.

  **Retry metadata on the invoice row** (two new optional fields, additive — no migration): `nextPaymentAttempt` (ISO time of Stripe's next Smart Retry) and `attemptCount`. The dunning hook receives these on the committed invoice so an email can tell the buyer when Stripe will retry.

  **No custom retry loop.** Recovery timing is owned by Stripe Smart Retries — enable it in the Dashboard (Billing → Revenue recovery → Retries for subscriptions; Settings → Billing → Invoices for one-time invoices). See the README "Dunning & smart retries" section.

  **Breaking (pre-1.0):** the internal `AsyncHookName` union grew by `afterInvoicePaymentFailed`. Apps using the recommended `webhookHandlers()` + `webhooks: internal.stripe` wiring need **no changes** — the pair is unchanged and the new hook field is optional.

  Note: covered by unit tests (hook scheduling, invoice state transition + retry metadata, `past_due`/`unpaid` persistence). The live `invoice.payment_failed` path (real failed-card subscription cycle) should be exercised by the E2E webhook run before release.

- [#64](https://github.com/kellykampen/better-stripe/pull/64) [`477e282`](https://github.com/kellykampen/better-stripe/commit/477e282ea1cfd2fc198f1aa19cc376eea96b38ca) Thanks [@kellykampen](https://github.com/kellykampen)! - Exact earnings totals — fix silently truncated financial figures past 50 rows.

  `listTransfersByAccount` and `listPayouts` cap their results at 50 rows, and the `useEarnings` hook summed those rows client-side — so an account with more than 50 transfers or payouts reported **silently wrong** (understated) gross / reversed / net / paid-out totals, with no error.

  **Fix:** two new server-side aggregate queries sum the account's whole ledger, paginated to completion, so totals are exact regardless of row count:

  - **`connect/queries/getAccountEarnings({ destinationAccountId, previewLimit? })`** → `{ gross, reversed, transferCount, transfers }`. Exact `gross`/`reversed` over every transfer (incl. reinstatements — the earnings view); `transfers` is a bounded preview (`previewLimit ?? 50`) for drill-down.
  - **`connect/queries/getAccountPayouts({ accountId, previewLimit? })`** → `{ paidOut, payoutCount, payouts }`. Exact `paidOut` over every `paid` payout; `payouts` is a bounded preview.

  Exact up to Convex's per-query read limit; beyond that the query throws (loud) rather than silently truncating — strictly safer than a fixed cap for money figures.

  **`createUseEarnings` now wires these aggregate queries** instead of the capped list queries. Its factory still takes `(useQuery, earningsQueryRef, payoutsQueryRef)` — point the refs at `getAccountEarnings` / `getAccountPayouts`. `UseEarningsResult` keeps `gross`/`reversed`/`net`/`paidOut`/`payouts`/`transfers` (now exact totals + a bounded preview) and adds `transferCount` / `payoutCount` for "showing N of M" UIs. `EarningsSummary` is unaffected (it reads the same figures).

  **Behavior change:** if you wired `createUseEarnings` against `listTransfersByAccount` / `listPayouts`, repoint the refs at the new aggregate queries. The list queries and `BetterStripe.listPayouts()` are unchanged, now documented as capped drill-down views. `listTransfersByCharge` (per-sale split legs) is unchanged and safe in practice — a sale has few legs.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Add `createUseEarnings` + `createUseSplitBreakdown` React hook factories ([#44](https://github.com/kellykampen/better-stripe/issues/44)).

  - `createUseEarnings(useQuery, transfersRef, payoutsRef)` → `useEarnings(accountId)` reads a recipient's transfer ledger and payouts, deriving `gross` (total transferred in), `reversed` (pulled back via fee collection + refund/dispute clawbacks — deliberately not labeled "fees", since a true platform-fees figure lives on the payments rows' `feeCollectedAmount`), `net`, `payouts`/`paidOut`, and the raw `transfers` for drill-down.
  - `createUseSplitBreakdown(useQuery, transfersByChargeRef)` → `useSplitBreakdown({ sourceChargeId, saleAmount? })` sums a sale's split legs by role (`store`/`affiliate`/`other`), each net of reversals, with the `platform` share derived when the caller supplies the sale amount.

  Both follow the `createUse*` factory convention from dispute hooks. Purely additive.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Add embedded Stripe Connect dispute components ([#48](https://github.com/kellykampen/better-stripe/issues/48)).

  The Stripe-hosted alternative to the headless dispute components, built on `@stripe/react-connect-js`:

  - `ConnectProvider` — initializes ConnectJS once per mount via `loadConnectAndInitialize({ publishableKey, fetchClientSecret, appearance?, locale? })` and provides the instance through `ConnectComponentsProvider`. `fetchClientSecret` wires to an app action wrapping `stripe.createDisputeSession({ stripeAccountId })`.
  - `EmbeddedDisputes` — mounts Stripe's `disputes_list` embedded component, or `payment_disputes` scoped to one payment via the `payment` prop. Must render inside `ConnectProvider`.

  Adds `@stripe/connect-js` and `@stripe/react-connect-js` as regular dependencies, mirroring the existing `@stripe/stripe-js`/`@stripe/react-stripe-js` convention. Purely additive.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Add headless `PayoutSchedule` component for recipient balance + payout display ([#46](https://github.com/kellykampen/better-stripe/issues/46)).

  Pure, hook-free component showing a seller's available/pending balance (from a `RecipientBalance` snapshot prop) and next payout — the earliest `pending`/`in_transit` payout row with an arrival date, templated as "Next payout of $40.00 expected Jul 10, 2026", falling back to a rolling-schedule message when none is upcoming (payouts are automatic/rolling; the component deliberately offers no manual withdrawal). Optional `manageUrl` link out to the hosted Express dashboard.

  Headless conventions: `className`, i18n label overrides, loading/empty states, and a `children` render-prop with all computed state. Data comes entirely via props (no data-fetching hook yet); purely additive.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Add product-level `statement_descriptor` so it covers a subscription's first charge ([#63](https://github.com/kellykampen/better-stripe/issues/63)).

  The invoice-time descriptor path sets the descriptor at `invoice.created`, which never reaches a subscription's first invoice — Stripe finalizes and (for `charge_automatically`/Checkout subscription-mode) pays invoice [#1](https://github.com/kellykampen/better-stripe/issues/1) synchronously at creation, before that handler runs. Per Stripe's descriptor precedence (Invoice → Product → charge-type default), a product-level `statement_descriptor` covers every cycle including the first.

  `createProduct`/`updateProduct` now resolve the per-store descriptor (the store's stored suffix, else the platform default — mirroring the account-level descriptor resolution) and stamp it onto the Stripe Product's `statement_descriptor`, for products with an `accountId`. No public API change to existing call shapes.

- [#70](https://github.com/kellykampen/better-stripe/pull/70) [`306d402`](https://github.com/kellykampen/better-stripe/commit/306d402b0148e0794a2239a5c83a0d3780300c38) Thanks [@kellykampen](https://github.com/kellykampen)! - Reclaim/expiry of dead reversal claims.

  Atomic reversal claims reserve reversal slices atomically before money moves; the executor now refuses to leapfrog an unexecuted predecessor claim. The residual, by-design failure mode: if the operation that reserved a slice dies permanently (its webhook exhausts Stripe's retries and never confirms), the claim frontier stays ahead of the confirmed `reversedAmount` forever, and every successor reversal on that leg blocks with `predecessor claim unexecuted`. This adds an ops path to resolve such wedged legs.

  - **`BetterStripe.listWedgedReversalClaims(ctx)`** — lists legs where `reversalClaimedAmount > reversedAmount` and the recorded ops holding the blocking (unexecuted) slice on each. An ops/admin diagnostic; scans the ledger to completion (exact, and loud past Convex's 16,384-doc read limit rather than silently truncating).
  - **`BetterStripe.reclaimReversalClaim(ctx, { operationId, mode })`** — resolves a dead claim:
    - `mode: "reexecute"` (default, always safe): replays the op's recorded slices under the original `bs_rev_<opId>_<transferId>` idempotency keys, moving any money that never moved and recording any that moved-but-wasn't-confirmed. Fills the hole so blocked successors proceed; cannot double-reverse.
    - `mode: "release"`: abandons the claim (rewinds each leg's frontier to the pre-claim amount and deletes the op record). Gated on BOTH the op being older than `minAgeMs` (default ~24h, past Stripe's idempotency-key window) AND live Stripe `amount_reversed ≤ slice.from` on every leg; the component mutation additionally refuses if a successor already claimed past the slice (re-execute instead).

  New component functions: `connect/queries/listWedgedReversalClaims`, `connect/queries/getReversalOp`, `connect/mutations/releaseReversalClaim`. No behavior change to existing reversal paths.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Add refund actor scoping — seller (own sales) vs platform admin ([#56](https://github.com/kellykampen/better-stripe/issues/56)).

  `createRefund` previously had no notion of who may initiate a refund. It now takes an optional `actor` option (`{ type: "admin" }` or `{ type: "seller", accountId }`) and enforces the rule before any Stripe call is made — an unauthorized refund never moves money. A platform admin may refund any sale; a seller may refund only sales routed to their own connected account (destination charge, or one of the split legs in a separate-charges split), resolved from the payment's own component-ledger routing. Fails closed: a seller is denied when the payment's routing can't be resolved.

  Additive and backwards compatible — omitting `actor` preserves the prior unrestricted behavior. The refund fee/transfer-reversal math from refund handling is unchanged.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Refunds now return the platform fee pro-rata and reverse recipient transfers ([#45](https://github.com/kellykampen/better-stripe/issues/45)).

  **Destination charges:** `createRefund` gains `refundApplicationFee` and `reverseTransfer` options, both defaulting `true`, sent only when the charge actually carries an application fee / destination transfer (sending either on an incapable charge is a hard Stripe error). Stripe pro-rates both natively for partial refunds; an explicit `false` always wins.

  **Split sales (transfer math):** a new `reverseTransfersForRefund` (driven from `refund.created`/`refund.updated`, so pending→succeeded ACH refunds and Dashboard-issued refunds both claw back) converges each ledger leg on a cumulative reversal target — `round(leg × amount_refunded / amount)` — and reverses only the delta above the already-recorded amount, so at-least-once webhook delivery can't double-record the ledger or trip Stripe idempotency-key conflicts.

  Additive; no breaking changes to `createRefund`'s existing call shape.

- [`11425b3`](https://github.com/kellykampen/better-stripe/commit/11425b3d91da6fd87650569c015de1bb75b7e61e) Thanks [@kellykampen](https://github.com/kellykampen)! - Add refund and dispute tracking (plan 011).

  **New webhook events** added to `BETTER_STRIPE_WEBHOOK_EVENTS` (add these to your event destination / endpoint's `enabledEvents`):

  - Refunds: `refund.created`, `refund.updated`, `refund.failed`
  - Disputes: `charge.dispute.created`, `.updated`, `.closed`, `.funds_withdrawn`, `.funds_reinstated`

  **New component tables:** `refunds` and `disputes`, synced from those events. Refunds denormalize cumulative state onto the linked `payments` row — two new optional fields, `refundedAmount` and `refundStatus` (`"partially_refunded" | "fully_refunded"`) — so consumers can answer "is this payment whole?" in a single read. Both additions are optional/additive (no migration required).

  **New `BetterStripe` methods:**

  - `createRefund`, `getRefundByStripeId`, `listRefunds`
  - `getDisputeByStripeId`, `listDisputes`, `updateDispute` (submit evidence), `closeDispute`

  **New triggers/hooks:** `SyncTriggers.refund` / `SyncTriggers.dispute` (sync, same-transaction) and `AsyncHooks.onRefundCreated` / `onDisputeCreated` / `onDisputeClosed` (async, after-commit).

  **Breaking (pre-1.0):** the internal `TriggerDispatcherName` / `AsyncHookName` unions grew (added `refundUpserted`, `disputeUpserted`, `afterRefundCreated`, `afterDisputeCreated`, `afterDisputeClosed`). Apps using the recommended `webhookHandlers()` + `webhooks: internal.stripe` wiring need **no changes** — the pair is unchanged and all trigger/hook fields are optional. No app-level migration is required.

  Note: V2 `customer_account` + `pause_collection`/dispute interplay and the refund-via-API path are covered by unit tests; the live E2E (`refund.created` via real API call, dispute triggers) should be run before release — `charge.dispute.funds_withdrawn`/`funds_reinstated` cannot be reliably triggered in test mode.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Add `SplitBreakdown` + `EarningsSummary` headless components ([#49](https://github.com/kellykampen/better-stripe/issues/49)).

  - `SplitBreakdown` renders a sale's store + affiliate + platform lines (the `other` bucket only when it carries money) from `useSplitBreakdown`'s totals. When the platform share is underivable (no sale amount given to the hook) it renders an explicit "Unknown without the sale amount" state — never a silent zero.
  - `EarningsSummary` renders gross / reversals / net / paid-out plus the latest payout status line. Its props are a subset of `useEarnings`'s result shape, so `<EarningsSummary {...useEarnings(accountId)} />` works directly.

  Consumes the earnings hooks hooks ([#44](https://github.com/kellykampen/better-stripe/issues/44)). Both headless/themeable (`className` + `children` render-prop). Purely additive.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Add per-store statement descriptors on destination charges ([#47](https://github.com/kellykampen/better-stripe/issues/47)).

  - New `BetterStripe.setAccountStatementDescriptor` method (validates first; `null` clears) writes a `statementDescriptor` field on the component's account record via a new `core/mutations/setStatementDescriptor` mutation.
  - New constructor option `statementDescriptorSuffix` sets a configurable platform-wide default (validated at construction, same pattern as `platformFee`), used whenever a store account carries no suffix of its own. Resolution order: store's stored suffix → configured default → none.
  - Applied on every destination charge: one-time payment mode sets `payment_intent_data.statement_descriptor_suffix` at session creation; subscriptions (which can't carry a suffix directly) stash the resolved value as a `bsStatementDescriptor` metadata marker, applied by a new `applyStatementDescriptor` webhook processor.

  Purely additive — no existing method signatures change.

- [`a821651`](https://github.com/kellykampen/better-stripe/commit/a82165187295c1b0992726566d9e96060370a0eb) Thanks [@kellykampen](https://github.com/kellykampen)! - Expand the subscription write surface with five new `BetterStripe` methods, all routing through the component's webhook-sync path (`customer.subscription.updated` → `subscriptionUpserted`) and returning `{ success: true }`:

  - `pauseSubscription` — sets `pause_collection` (defaults `behavior: "keep_as_draft"`, optional `resumesAt`).
  - `resumeSubscription` — clears `pause_collection` via the empty-string sentinel.
  - `updateSubscriptionPrice` — swaps the first item's price; defaults `prorationBehavior: "none"` (no proration line items), caller-overridable.
  - `updateSubscriptionMetadata` — merges/upserts metadata keys (existing keys not included are preserved).
  - `updateSubscriptionTrialEnd` — extends or ends a trial (`"now"` or a Unix timestamp).

  Also: the existing `cancelSubscription`, `reactivateSubscription`, and `updateSubscriptionQuantity` now wrap their Stripe SDK calls in `throwStripeError`, so failures surface as a structured `ConvexError<BetterStripeError>` (`STRIPE_API_ERROR`) instead of a raw `Error`.

- [#54](https://github.com/kellykampen/better-stripe/pull/54) [`3c5f07b`](https://github.com/kellykampen/better-stripe/commit/3c5f07bbd89f1461f616be04fa2bf23276487377) Thanks [@kellykampen](https://github.com/kellykampen)! - Add `BetterStripe.listTransfersByCharge` and `BetterStripe.listTransfersByAccount` — client read wrappers over the component's transfer-ledger queries.

  - `listTransfersByCharge(ctx, { sourceChargeId, limit? })` — a sale's original split legs (reinstatement rows excluded), the read behind the `useSplitBreakdown` hook / per-sale breakdown UIs.
  - `listTransfersByAccount(ctx, { destinationAccountId, limit? })` — a recipient's transfer ledger (the earnings view, includes reinstatements), the read behind the `useEarnings` hook.

  The underlying component queries already existed, but there was no client-side method to reach them, so an app couldn't wire the `useSplitBreakdown` / `useEarnings` hook factories to real data. These thin read wrappers close that gap (surfaced while building the affiliate-split demo).

- [#58](https://github.com/kellykampen/better-stripe/pull/58) [`61f755e`](https://github.com/kellykampen/better-stripe/commit/61f755ebf38065d5c3cc73db18e7dfd1c3d8c394) Thanks [@kellykampen](https://github.com/kellykampen)! - `updateDispute` now stages evidence by default instead of submitting it.

  Stripe's dispute-update `submit` parameter **defaults to `true`**, so evidence sent without an explicit `submit` is submitted to the bank — a one-shot, outcome-affecting action. The previous docblock incorrectly said omitting `submit` "saves a draft", and the method forwarded `submit` only when explicitly set, so a caller following the docs would submit unintentionally.

  **Behavior change:** when `evidence` is provided **without** an explicit `submit`, `updateDispute` now sends `submit: false` (stages a draft). Callers must pass `submit: true` to finalize and submit to the bank.

  - A bare metadata/status update (no `evidence`) is unchanged — no `submit` is forced.
  - An explicit `submit: true` / `submit: false` is always honored.
  - `EvidenceForm` already passes `submit` explicitly, so it is unaffected.

  If you relied on the old behavior of submitting evidence by omitting `submit`, pass `submit: true` explicitly.

### Patch Changes

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Regenerate the component's `_generated` API so transfer/dispute queries are typed for consumers ([#71](https://github.com/kellykampen/better-stripe/issues/71)).

  `src/component/_generated/component.ts` was stale — it predated `listTransfersByCharge`/`listTransfersByAccount` and `getDisputeByStripeId`/`listDisputes`, so `components.betterStripe.connect.queries.*` for those methods was untyped for any consumer reaching into the raw component API. Regenerated via `npx convex codegen`; no source logic changed, generated bindings only.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Fix: `updateDispute` now sends an explicit `submit: false` on every call, including metadata-only updates ([#67](https://github.com/kellykampen/better-stripe/issues/67)).

  Earlier evidence handling made evidence-bearing `updateDispute` calls stage by default (`submit: false`), but left metadata-only updates sending no `submit` key at all — inheriting Stripe's server-side default, which Stripe's docs state is `true` on every update. Empirically, a metadata-only update does not submit previously staged evidence today, but that leniency contradicts the documented default and submission is one-shot and outcome-affecting. `updateDispute` now never omits `submit`: every call — evidence, metadata, or both — sends an explicit `submit: false` unless the caller passes `submit: true` to finalize.

  No public API change; the safer default only ever narrows behavior (no call that previously submitted now stages, and vice versa).

- [#68](https://github.com/kellykampen/better-stripe/pull/68) [`4d1b843`](https://github.com/kellykampen/better-stripe/commit/4d1b843cb9891a313c9b9a270ca067e36c686420) Thanks [@kellykampen](https://github.com/kellykampen)! - Fix a first-invoice fee double-reversal crack.

  `applyFirstInvoiceFee` recomputed the platform fee from **live** subscription metadata (`bsFeeConfig`) on every webhook retry. If the transfer reversal succeeded but the `bsFeeCollected` invoice-marker write then failed (event marked `failed`), and the platform edited `bsFeeConfig` before Stripe redelivered, a retry landing **after** Stripe's ≤24h idempotency-key window would recompute a _different_ fee and create a **second** reversal — double-collecting the fee.

  **Fix:** before reversing, `applyFirstInvoiceFee` now lists the destination transfer's existing reversals and adopts one tagged `metadata.bsFeeFor:<invoiceId>` as the idempotency source of truth. That tag survives both the marker-write failure and the idempotency-key TTL, so a retry re-records the marker with the already-reversed amount instead of reversing again — mirroring the per-charge fee collector's frozen-config guarantee. No API surface change.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Fix: collect the fixed/tier platform fee on a subscription's first invoice ([#52](https://github.com/kellykampen/better-stripe/issues/52)).

  `applyPerInvoiceFee` applies a fixed/tier `application_fee_amount` at `invoice.created`, which only works while the invoice is still a draft. Stripe finalizes a `charge_automatically` subscription's first invoice synchronously at creation (and Checkout subscription-mode pays it during checkout), so `invoice.created` fires with an already-`open` invoice — the update is silently rejected and the first cycle's platform fee was lost on every destination-charge subscription with a fixed/tier fee. Percent-only fees and renewal invoices (which get Stripe's ~1h draft window) were unaffected.

  Fixed with a new `applyFirstInvoiceFee` processor hooked at `invoice.paid`: it collects the missed fee via a partial reversal of the automatic destination transfer, sized from `amount_paid` — the same mechanism the per-charge fee collector's `applyPerChargeFee` uses for one-time charges. Skips any invoice whose fee the draft path already collected, so there's no double-collection. No public API change.

- [#21](https://github.com/kellykampen/better-stripe/pull/21) [`1f43345`](https://github.com/kellykampen/better-stripe/commit/1f433459ec6eb11d75982f1ed883cff9414d4e15) Thanks [@kellykampen](https://github.com/kellykampen)! - Fix `createPrice` orphaning a Stripe price when the product is missing from the component DB.

  `createPrice` previously called `stripe.prices.create(...)` **before** verifying the product existed in the component DB, then threw `PRODUCT_NOT_FOUND` afterward — leaving an orphaned price in Stripe with no corresponding component record. The product lookup now runs **first**, so a missing/unsynced product throws before any Stripe write happens. No API change; behavior only differs on the error path.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Fix: collect deferred `per_charge` platform fees via transfer reversal ([#38](https://github.com/kellykampen/better-stripe/issues/38)).

  `bsFeeMode="per_charge"` (used when a one-time destination charge's final amount isn't known up front — discounts, `custom_unit_amount` prices, or a `sessionOverrides`-replaced `line_items`) had no webhook consumer, so the fixed/tiered platform fee was silently never collected on those charges.

  Fixed with a new `applyPerChargeFee` processor at `payment_intent.succeeded`: it collects the fee the same way Stripe itself settles application fees on destination charges — a partial reversal of the automatic destination transfer, sized by `computeFee` from the amount actually charged (`amount_received`). No public API change; charges that already pass `amount` up front (computing `application_fee_amount` at session creation) are unaffected.

- [#66](https://github.com/kellykampen/better-stripe/pull/66) [`a47d64d`](https://github.com/kellykampen/better-stripe/commit/a47d64d39ece42b4cc0d96508e9b87925c6bf8e9) Thanks [@kellykampen](https://github.com/kellykampen)! - Fix `addRecipientConfiguration` not persisting `appliedConfigurations` to the component DB.

  `addRecipientConfiguration` applied the V2 recipient configuration on Stripe but never wrote the result back to the component `accounts` row, unlike `addCustomerConfiguration` which re-fetches and records `applied_configurations` after every update. Callers had to manually run `syncAllAccounts` afterward to reconcile the component DB, leaving it stale in between — anything reading `appliedConfigurations` off the component row (e.g. billing-view/UI gating) saw an out-of-date picture. `addRecipientConfiguration` now follows the same pattern: re-fetch the account after the Stripe update, read `applied_configurations`, recover the owning `userId` from the existing component record (failing closed with `ACCOUNT_NOT_FOUND` if the account isn't in the component DB yet), and `upsertAccount`. No public API change on the call side; the return shape now includes `appliedConfigurations` alongside `success`, matching `addCustomerConfiguration`.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Fix three transfer-reversal money races via atomic reversal-slice claiming ([#61](https://github.com/kellykampen/better-stripe/issues/61)).

  - Dispute clawback (amount mode): a retry after partial success recomputed per-leg amounts from mutable ledger state — a same-params replay could double-record the ledger, or a shifted remainder could resend different params under an already-used Stripe idempotency key, causing a permanent event-retry loop.
  - Refund clawback (delta-to-target): two distinct refunds racing between the ledger read and the Stripe call could both compute the same reversal target from stale state, over-reversing a leg and under-recording the ledger.
  - `payment_intent.succeeded` redelivery could have `upsertPayment`'s blanket patch rewrite `feeCollectedAmount` back to the gross fee, bypassing the monotonic fee-refund guard.

  Fixed by claiming the exact reversal slice atomically, in a new component mutation, before any money moves — so a retry re-adopts the already-claimed slice instead of recomputing and re-reversing it. No public API change.

## 0.3.0

### Minor Changes

- [#16](https://github.com/kellykampen/better-stripe/pull/16) [`2fdbdf3`](https://github.com/kellykampen/better-stripe/commit/2fdbdf3ae2da75cb510d767e8e8787a5bab06d8b) Thanks [@kellykampen](https://github.com/kellykampen)! - Simplify webhook handler registration: replace the 18-export `triggersApi()` with a single `stripe.webhookHandlers()` returning a `{ syncWebhook, asyncWebhook }` pair, wired via `registerRoutes(..., { webhooks: internal.stripe })`.

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

<!--
  This file is maintained by Changesets — do not hand-edit released sections.
  To record a change, run `pnpm changeset` and commit the generated file in
  `.changeset/`. New version sections are prepended above by `changeset version`
  (run automatically in the "Version Packages" PR). History below 0.3.0 was
  written by hand before Changesets was adopted.
-->

## 0.2.0 — 2026-06-11

### Breaking

- Trigger system is now wired into webhook processing. `triggersApi()` no longer returns `on*`/`after*` wrappers keyed by event; it returns 9 sync dispatchers (`accountUpserted`, `productUpserted`, `priceUpserted`, `subscriptionUpserted`, `subscriptionDeleted`, `checkoutSessionUpserted`, `invoiceUpserted`, `paymentUpserted`, `payoutUpserted`) plus 9 async hook wrappers (`afterAccountUpdated`, `afterCheckoutCompleted`, `afterSubscriptionUpdated`, `afterSubscriptionCanceled`, `afterTrialEnding`, `afterInvoicePaid`, `afterPaymentSucceeded`, `afterPaymentFailed`, `afterPayoutCompleted`). Each dispatcher performs the component upsert and the configured sync trigger in one transaction; `after*` hooks are scheduled via `ctx.scheduler` after the event is marked processed.
  - Migration: export all 18 names from a Convex module and pass it to `registerRoutes` via the new `triggers` config (`triggers: internal.stripe`, no cast needed). See the README Quick Start.
- `listPayouts` filter renamed `accountId` → `stripeAccountId`, with new optional `status` and `limit` filters.

### Added

- `getInvoice` / `getInvoiceByStripeId` client query methods, plus `getInvoiceByStripeId`, `getPaymentByStripeId`, and `getPayoutByStripeId` component queries.
- `createAccountSession` for Stripe Connect embedded account management (throws structured `ConvexError(BetterStripeError)` on failure).
- `customer.subscription.trial_will_end` webhook support (fires the `onTrialEnding` async hook); V1 event constant list grows to 20 events (32 total).
- Account-scoped listing: `listSubscriptions` now accepts `{ stripeAccountId?, status?, limit? }` and `listInvoices` accepts `stripeAccountId`; new `accountId` indexes on `checkoutSessions`, `invoices`, and `payments`.
- `TriggerApiRefs` type and `triggers` field on `RegisterRoutesConfig`.
- React: `countryPlaceholder` i18n prop on `AccountCreateCard`.
- Example app: trigger dispatchers wired into `registerRoutes`; billing portal session created via a component-backed action.
- Example app: automated E2E webhook test harness (`npm run e2e:webhooks`) — fires real Stripe-signed events via `stripe trigger`/`stripe listen` against the deployed endpoint and asserts the ledger plus a new `triggerLog` table that records every sync-trigger/async-hook invocation (sync triggers write in the same transaction as the dispatcher).

### Fixed

- V2 thin-event verification was broken under stripe-node v22: `webhooks.constructEventAsync` rejects thin payloads after verifying the signature, so every correctly signed `v2.core.*` event was returned a 400. `verifyV2Event` now uses `stripe.parseEventNotificationAsync`.
- Failed webhook ledger events are reprocessed on Stripe retry instead of deduplicating forever; sync-trigger failures roll back the component upsert and return 500 so Stripe retries.
- Async hooks now run after the upsert transaction commits, with the committed doc.
- React rules-of-hooks violations: `useQuery` is always called, using Convex's `"skip"` sentinel in 6 conditional read hooks.
- React: `AddCardForm` tracks real processing/error state; `BillingPortalLink` tracks async loading state.
- `clearAllTables` now also clears the `webhookEvents` ledger.
- `getTrialStatus` trial fields derived from shared subscription fields.

### Changed

- Component return validators fully typed — 30 `v.any()` return validators replaced across core, products, billing, connect, and webhooks; client status unions narrowed and `as any` casts dropped.
- Stripe API version pin upgraded to `2026-05-27.dahlia`; dependencies bumped (convex 1.41, stripe-js 9.8, react-router 7.17).

## 0.1.0

- Initial extraction from Dojo monorepo
- Stripe V2 Accounts API support
- Webhook handling (V1 snapshot + V2 thin events)
- Full CRUD for accounts, products, prices, subscriptions, checkout sessions, invoices, payments, payouts
