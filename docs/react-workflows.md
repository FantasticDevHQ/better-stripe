# React workflows

Import the example's reusable UI and workflow hooks from
`@fantastic.dev/better-stripe/react`. You do not need the example's route tree,
role provider, Tailwind, or shadcn components.

Components render semantic HTML without package CSS. Use their render props or
companion hooks to supply your own design system. Stripe iframe contents use
Stripe's `appearance` options and retain Stripe's own styling.

## Charge and Price currency units

`getChargeCurrencyMetadata`, `chargeAmountToDecimal`, `parseChargeAmount` and `formatChargeAmount` are
browser-safe pure helpers exported from the main package and `/react`. They
apply Stripe charge/Price rules, not payout or Global Payouts rules. See
[Stripe currencies](https://docs.stripe.com/currencies).

```ts
import {
  getChargeCurrencyMetadata,
  parseChargeAmount,
  formatChargeAmount,
} from "@fantastic.dev/better-stripe/react";

getChargeCurrencyMetadata("jpy"); // { currency: "jpy", apiDecimals: 0, displayDecimals: 0 }
parseChargeAmount("500", "jpy"); // 500
formatChargeAmount(500, "jpy"); // ¥500
parseChargeAmount("500", "isk"); // 50000, compatibility units
parseChargeAmount("10.45", "huf"); // 1045, charge fractions are supported
parseChargeAmount("1.005", "usd"); // null, no rounding
```

The parser accepts nonnegative ASCII decimals, including zero, and returns a
safe integer or `null`. Reject a zero refund or non-free product separately in
the authorized operation. Exponents, separators, signs, excess precision and
unsafe integers are invalid. ISK/UGX accept whole amounts and use two-decimal
API compatibility units. Zero-decimal charge currencies include JPY and MGA.
HUF/TWD charges retain two decimals despite their payout restrictions. Unknown
currencies and unsupported three/four-decimal precision fail closed; formatting
invalid amounts throws `RangeError`. The formatter supports signed adjustments
and preserves negative sub-unit values. Parsing new charge inputs remains
nonnegative. No helper performs FX or provider writes. Environments without
`Intl.supportedValuesOf` fail closed with no recognized currencies.

`PriceCard` and `formatPriceWithInterval` use the strict charge/Price rules.
The legacy `formatPrice` display helper also serves observed account balances
and signed costs. It preserves fractional ISK/UGX minor units without applying
whole-charge eligibility, so an observed UGX balance of `101` displays `1.01`.
It is not a charge validator. No helper establishes payout eligibility or
Global Payouts units.
Missing/null amounts display `Custom price`, distinct from a real zero price.
Pass `customPriceLabel` and `locale` to `PriceCard` for translated presentation,
or the third argument to `formatPriceWithInterval` for a custom missing-amount
label. The Vite Products component example keeps the package's formatted price
inside its Shadcn render prop. Invalid non-null provider values must be handled
by the host's error boundary rather than presented as a fabricated amount.

Metadata describes precision only. Derive selectable presentment currencies
from the public `getCountrySpecs` result and validate account/payment-method
support on the server. Do not derive an account's supported currencies from
`Intl.supportedValuesOf` or this helper. Refunds and PlanPricingEditor reuse the
charge helpers for original-currency inputs; neither establishes payout units.

## Bind your backend

Pass authenticated server callbacks and query results to the components. This
keeps your user IDs, authorization, database schema, and business rules in your
application. The example's pages demonstrate Convex adapters for these callbacks.
A callback is an API contract, not an authorization boundary. The server must
check account ownership, price IDs, amounts, referral attribution, and permissions.

`scopeKey` identifies the authenticated account or customer. Change it when that
identity changes so pending responses cannot populate another account's UI.
For checkout, change `orderKey` when the customer, price, or attribution changes.
Do not put secret keys in these props. Browser code needs only a publishable key
and short-lived client secrets returned by your server.

## Choose a checkout

`Checkout` supports all five checkout integrations. It creates the session or
PaymentIntent, handles loading and retry, mounts the required Stripe provider,
and reports confirmation errors. Hosted Checkout waits for an explicit click.
`CheckoutChooser` renders the five choices and their pros and cons. It supports
controlled selection, render props, and a recurring-product compatibility notice.
`CHECKOUT_OPTIONS` also exports the descriptions.

```tsx
import { Checkout } from "@fantastic.dev/better-stripe/react";

// createSession is your authenticated server binding. It must validate priceId.
function Purchase({ publishableKey, priceId, createSession }) {
  return (
    <Checkout
      mode="custom"
      publishableKey={publishableKey}
      orderKey={priceId}
      returnUrl={`${window.location.origin}/receipt?session_id={CHECKOUT_SESSION_ID}`}
      createSession={({ mode, requestId }) =>
        createSession({ priceId, uiMode: mode, requestId })
      }
    />
  );
}
```

The callback returns `{ stripeSessionId, clientSecret?, url? }`. It must return
`url` for `redirect` and `clientSecret` for the other session modes. Use the
request ID for server idempotency. Retries and rerenders preserve the same ID.
Changing `orderKey` or checkout mode starts a new logical request. Pass a persisted
`requestId` prop to preserve identity across unmounts or page reloads. Forward it
to your authenticated server and Stripe request options; also enforce durable
application-level duplicate-order protection.

| Mode             | Stripe integration                    | Tradeoff                                                               |
| ---------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| `redirect`       | Hosted Checkout Session               | Least UI work, leaves your app                                         |
| `embedded`       | Embedded Checkout Session             | Complete Stripe checkout in your page, less layout control             |
| `custom`         | Checkout Session with Payment Element | Custom form layout with Checkout's session model                       |
| `payment-intent` | PaymentIntent with Payment Element    | Payment control, application owns order and subscription orchestration |
| `form`           | Preview Embedded Checkout Form        | Compact Stripe form, requires the supported Stripe preview             |

For `payment-intent`, provide `createPaymentIntent({ requestId })` instead of
`createSession`. Return `{ paymentIntentId, clientSecret }`. Payment Intents do
not create subscriptions. Stripe.js supplies the browser SDK and publishable-key
handling for these flows; it is not a separate server payment model.

Use `renderForm` on the custom and PaymentIntent modes to render your own email
input, `paymentElement`, error, and submit button. The preview `form` mode renders
Stripe's form and does not use that renderer. `children` replaces the outer
checkout frame and receives `content`, `isLoading`, `error`, and `retry`.
Respect `state.emailReadOnly` on your email input. Custom Checkout uses the
email Stripe supplied when the session loaded and skips `updateEmail` for that
session. Guest sessions without an email collect it before confirmation and
keep it editable if a payment attempt fails.
The lower-level `CheckoutElementsForm`, `PaymentIntentForm`, and `CheckoutForm`
are also exported for an existing client secret.

Only a server-confirmed payment or checkout session should grant access to the
product. Use `PaymentReceipt` or `CheckoutStatus` with webhook-backed query data;
a browser return URL alone does not prove payment.

## Via API, BetterStripe components, or Stripe embedded

The switch labels are **via API**, **BetterStripe components**, **Stripe embedded**,
and **Stripe hosted**. BetterStripe components are the unstyled exports from this
package; Stripe embedded views mount Stripe's Connect UI. The internal mode keys
remain `headless`, `components`, `embedded`, and `hosted` for compatibility, including
existing `?example=headless` links. The package's native components accept render
props so the example can match the API view's cards and layout.

`Account`, `Onboarding`, `Disputes`, `Refunds`, `Earnings`, and `Payouts` accept
`presentation="embedded"` with Connect session props. Their default headless
presentation accepts domain-specific data and callbacks. `Connect` also exposes
account, onboarding, payments, refunds, disputes, balances, payouts, and
notifications widgets directly.

```tsx
import { IntegrationSwitch, Payouts } from "@fantastic.dev/better-stripe/react";

function AccountPayouts({
  accountId,
  publishableKey,
  loadPayouts,
  createSession,
}) {
  return (
    <IntegrationSwitch
      views={{
        headless: <Payouts scopeKey={accountId} load={loadPayouts} />,
        embedded: (
          <Payouts
            presentation="embedded"
            scopeKey={accountId}
            publishableKey={publishableKey}
            fetchClientSecret={async () => (await createSession()).clientSecret}
          />
        ),
      }}
    />
  );
}
```

The server creates an Account Session for the authenticated connected account
and enables the requested component and features. Session refresh uses the latest callback. Appearance and locale updates apply
to the active Connect instance without remounting it. Changing the publishable
key creates a new instance. `IntegrationSwitch` mounts only the active view and has
no router dependency. It also supports controlled `value`/`onValueChange` and
`components` and `hosted` views when your workflow has those alternatives.

Connect displays only the payment data supported for that connected account.
The example's platform-owned separate-charges-and-transfers ledger remains in
its headless sales/refund/dispute views. A Connect embed cannot turn that ledger
into connected-account-owned charges. Refunds use the Connect Payments widget;
there is no separate Connect refund catalog widget. Product management,
customer subscriptions, and platform billing do not have equivalent Connect
widgets. Use package UI or the hosted Billing Portal for those workflows.

## Component and hook reference

| Workflow              | Unstyled components                                                                                            | Companion hooks/helpers                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Store browsing        | `Storefront`, `PriceCard`                                                                                      | Store/product/price models and purchase callbacks                            |
| Checkout              | `CheckoutChooser`, `Checkout`, `CheckoutElementsForm`, `PaymentIntentForm`, `CheckoutForm`, `EmbeddedCheckout` | `CHECKOUT_OPTIONS`                                                           |
| Receipts              | `PaymentReceipt`, `CheckoutStatus`                                                                             | Server-backed payment/session data                                           |
| Earnings              | `Earnings`, `EarningsSummary`                                                                                  | `earningsFromBalance`                                                        |
| Payouts               | `Payouts`, `PayoutSchedule`, `PayoutHistory`, `PayoutOverview`                                                 | `getPayoutTotals`                                                            |
| Sales                 | `Sales`, `ReferredSales`                                                                                       | Server-authoritative economic rows                                           |
| Refunds               | `Refunds`, `RefundHistory`                                                                                     | `useRefunds`, `parseRefundAmount`; legacy USD-only `parseAmountCents`        |
| Disputes              | `Disputes`, `DisputesList`, `DisputeDetail`, `EvidenceForm`, `ChargebackLedger`                                | `useDisputeResponse`                                                         |
| Onboarding            | `Onboarding`                                                                                                   | `useOnboarding`                                                              |
| Accounts              | `Account`, `AccountConfigurations`                                                                             | `useAccountManager`                                                          |
| Product management    | `Products`                                                                                                     | `useProductManager`                                                          |
| Subscriptions         | `Subscriptions`, `SubscriptionManager`, `SubscriptionOverview`, `SubscriptionCard`                             | `useSubscriptionManager`, `useSubscriptionFilter`, `currentSubscriptionFrom` |
| Billing               | `BillingPlans`, `BillingPortal`, `InvoiceEstimate`, `Invoices`, `BalancePaymentSource`                         | `usePlanBilling`, `useInvoiceEstimate`, `useBalanceFunding`                  |
| Payment methods       | `PaymentMethods`, `PaymentMethodsList`, `AddCardForm`                                                          | `usePaymentMethodsManager`, `toPaymentMethodItem`                            |
| Seller cost recovery  | `CostRecovery`                                                                                                 | Server-calculated outstanding/collected/invoiced amounts                     |
| Referral sharing      | `ReferralLinks`, `ClipboardButton`                                                                             | `useReferralLinks`                                                           |
| Admin                 | `Overview`, `WebhookEvents`                                                                                    | `useWebhookFilters`, `webhookQueryArgs`                                      |
| Sandbox setup/testing | `StripeSetup`, `SandboxTesting`, `WorkflowTasks`, `WebhookSetup`, `EnvironmentStatus`, `FixtureProgress`       | `useTaskRunner`, `useWebhookSetup`                                           |
| Shared state/tables   | `IntegrationSwitch`, `Collection`                                                                              | `useWorkflowAction`, `useWorkflowResource`                                   |

The example still owns its navigation, persona switcher, application branding,
server authorization, sandbox fixture definitions, and marketplace fee policy.
Its styled forms and tables consume package hooks/render props. The package's
default components implement those workflows without the example's providers.
The package does not seed or reset a Stripe account just because a component
mounts. Setup/testing tasks call the operations you explicitly bind.

## Data contracts and styling

`Payouts.load(cursor?)` returns a `PayoutSnapshot` with `balances`, `payouts`,
`upcoming`, and `nextCursor`. Each balance has `currency`, `available`, and
`pending`. Payout rows include `id`, `amount`, `currency`, `status`, `arrivalDate`,
and `created`. The component shows available and pending balances, the next
known payout and arrival date, upcoming payouts, and paginated previous payouts.
Render props expose `upcomingPayouts` sorted by arrival date,
`previousPayouts`, and `nextPayout`. Use these package-owned classifications
in custom UI; completed or failed payouts are excluded from upcoming payouts.
If Stripe has not provided an upcoming payout, the UI says so rather than
inventing a date.

Payout, invoice-estimate, cost, and webhook timestamps use Unix milliseconds.
Subscription period/trial fields use ISO date strings, matching the existing
subscription API. Convert raw Stripe Unix seconds in your adapter. Money values use integer minor units. The current decimal refund
input and price-formatting helpers use two decimal places, as in the USD
example. Supply custom rendering/input conversion for zero-decimal and
three-decimal currencies. Never combine balances across currencies.

Sale fees, affiliate shares, recovery costs, invoice estimates, and settlement
statuses come from server data. The UI does not recalculate the example's fee
policy or charge outstanding costs by itself. Balance funding requires explicit
consent and a server integration with Stripe's supported preview. Card fallback,
renewal recovery, and debt collection remain server business rules.

Use exported `*Props`, row models, and render-state types for typed adapters.
Tables accept optional columns and a `children(state)` renderer. Action hooks
expose pending, error, and results so your buttons and alerts share the same
validation and duplicate-submit handling as the native components.

```tsx
import { Invoices } from "@fantastic.dev/better-stripe/react";

function InvoiceList({ invoices }) {
  return (
    <Invoices rows={invoices}>
      {({ rows, isLoading, isEmpty }) =>
        isLoading ? (
          <p>Loading invoices…</p>
        ) : isEmpty ? (
          <p>No invoices yet.</p>
        ) : (
          <ul>
            {rows.map((row) => (
              <li key={row.stripeInvoiceId}>{row.stripeInvoiceId}</li>
            ))}
          </ul>
        )
      }
    </Invoices>
  );
}
```

Default markup has `data-better-stripe` attributes for scoped CSS. Use render
props to replace markup with your design system, including labels and locale
formatting. A render function replaces the supplied markup; render its `content`
or `paymentElement` where those are part of the state's contract.

## Example coverage

See [the page audit](react-workflows-audit.md) for the mapping from every example
page to package components and hooks. `ChargeSummary` displays server-calculated
charge/fee/payout figures. `PaymentDetails` displays recorded charge and refund
state. `PayoutOverview` shows payout activity totals, which are separate from the
available and pending Stripe balances shown by `Payouts`.

`DEFAULT_CONNECT_COUNTRIES` provides the example's eight country choices and is
shared by its account pages and native `Onboarding`. Supply `countries` to limit
or expand the UI for your platform. This default is not a complete list of
Stripe-supported countries; your server must validate account eligibility.

## Cursor pagination

Use `useCursorPagination(accountId)` to keep a page number, current cursor, and
Previous/Next history. Pass `cursor` to your backend's paginated query and call
`next(result.continueCursor)` only when `result.isDone` is false. Changing the
scope key resets the history to page 1.

`Pagination` renders unstyled Previous/Next buttons and an announced page number,
or accepts a render function for your design system. Supply `canPrevious`,
`canNext`, `isLoading`, `onPrevious`, and `onNext`. Navigation is disabled while
loading. The example's affiliate sales page uses this with the component query
`connect.queries.paginateTransfersByAccount`, which returns newest-first cursor
pages scoped to the recipient account. Earnings totals still use aggregate
queries independently of pagination.

## Original-currency refunds and reversals

`Refunds` and `useRefunds` accept `paymentCurrency` for the selected
`paymentIntentId` and independent `sourceChargeCurrency` for `sourceChargeId`.
Derive both from authorized original records. The Vite seller refunds page
loads the selected payment before parsing a partial refund. Its readonly
`getRefundChargeContext` adapter reads the component's stored settlement allocation
for the selected source charge and matches the claimed persona's current account
to its original `store` leg. Missing allocations, unavailable accounts, foreign
store legs and affiliate/collaborator-only recipients return no context. Partial
reversals remain disabled until the selected charge has supported verified currency,
independently of payment currency. A charge without verified currency can still use
its separately authorized full operation, but cannot submit an assumed-USD partial
amount. This adapter adds no provider calls, writes or settlement ledger.

The example binds a client-claimed demo persona, not an authenticated identity.
Production hosts such as Dojo must derive an enabled user from the authenticated
session, authorize merchant ownership on the server and expose only the permitted
original-charge context. Loading context does not authorize a reversal.

```tsx
<Refunds
  scopeKey={authenticatedUser.id}
  paymentIntentId={selectedPayment.stripePaymentIntentId}
  paymentCurrency={selectedPayment.currency}
  sourceChargeId={verifiedOriginalCharge.id}
  sourceChargeCurrency={verifiedOriginalCharge.currency}
  issueRefund={authorizedRefund}
  reverseTransfers={authorizedRecoveryReversal}
/>
```

The callbacks remain application-authenticated server bindings. Their optional
`amountCents` property keeps its legacy name but contains exact provider units
in the original operation's currency, not universal hundredths. JPY 500 emits
500; ISK 500 emits 50000; HUF/TWD charges retain fractions. Full operations omit
the property entirely. Currency parsing does not authorize a refund, calculate
the remaining refundable balance, reverse ordinary-refund legs a second time,
cancel a subscription or change access.

Omitting a currency retains the legacy USD contract. Pass explicit `null` while
original currency is unknown; partial operations then fail safely. An explicit
currency requires its matching original identifier prop. Editing to another
identifier cannot reuse the old currency; the host must select/load its verified
record. Unknown currencies, unsupported precision, unsafe integers, scientific
notation, excess decimals and nonpositive partial amounts never reach callbacks.
`parseRefundAmount(value, currency)` exposes this exact positive parser through
`/react`. `parseAmountCents(value)` remains a USD-only compatibility wrapper.

Headless state exposes both currencies and nullable `refundInputDecimalPlaces`
and `reversalInputDecimalPlaces`. Use these for translated labels and input
precision. Fields, pending/error/result state reset by authenticated scope,
selected identifiers and currencies. Late completion cannot update another
context. Changing the view does not cancel an already-submitted server operation;
reconcile that intent before requesting another. Revalidate authorization,
original merchant/currency, positive units, remaining refundable limits and
stable provider idempotency on the server before moving money.

The example's older refund-history aggregate still sums a capped row set and
formats it as USD. That is a separate outstanding presentation limitation; do
not port it as an account total. Original-currency input support does not certify
that aggregate or claim a live refund.

## Store-plan pricing editor

`PlanPricingEditor` accepts a `plan` with `id`, `name`, `monthlyAmount` in minor
units, nullable `feeBasisPoints`, and `version`, plus `onSave(update)`. The update
contains `monthlyAmount`, `feeBasisPoints`, and `expectedVersion`. Blank fees
mean processing-only. Native fields are unstyled; use the render prop to supply
your design system. Server-side authorization, fee floors, Stripe Price creation,
and conflict checks belong in your backend. Existing subscription migration is
an application policy, not an automatic side effect of this editor.

The plan also accepts optional `currency`, defaulting to `usd` for existing
consumers. The callback shape stays unchanged. Derive its plan, currency and
version from authorized server data, validate the stored currency/version again
before creating a price, and enforce country/account/payment-method support on
the server. React does not change provider prices or authorize a currency.

Initialization uses `chargeAmountToDecimal` to retain exact ASCII decimal
strings, including the final minor unit at `Number.MAX_SAFE_INTEGER`. Saving
uses `parseChargeAmount` without floating-point multiplication or rounding.
JPY/MGA inputs use whole units; ISK/UGX inputs also use whole major units while
callbacks emit their two-decimal compatibility units. HUF/TWD charge inputs
retain two decimal places. Unsupported currencies, excess precision, unsafe
units and nonpositive monthly prices never reach `onSave`. Invalid stored
amounts initialize blank instead of inventing a valid price.

Headless state exposes `currency` and nullable `inputDecimalPlaces` in addition
to editable strings. Use them for your currency label, input mode and step, as
the Vite admin store-plans page does. The example's current backend plans remain
USD; a host with another supported currency must pass its verified plan currency.
Fields, pending state, errors and prior success messages reset when plan ID,
version or currency changes. A late save from the previous scope cannot update
the new editor. Retries retain the current version; server conflict handling and
idempotency remain the host's responsibility. Fee and affiliate defaults are
unchanged.

`PlanPricingEditor` also supports optional `affiliateBasisPoints` on the plan and
save update, defaulting to 0. Its render state exposes `affiliateShare` and
`setAffiliateShare`. The native field is labeled Affiliate payout (%), accepts
0 through 100 with at most two decimal places, and saves integer basis points.
Omitting the field in an older backend request preserves an existing configured
rate. The example applies this rate after sale fees and records it with each
settled sale.

## Product and subscription affiliate-rate editor

`AffiliateRateEditor` accepts `scopeKey`, nullable `affiliateBasisPoints`,
`effectiveBasisPoints`, `source` of global/store/plan/product/price/none, `version`, and `onSave`.
Its save update contains nullable `affiliateBasisPoints` and `expectedVersion`.
Blank input means inherit, zero disables commission, and percentages support
0 to 100 with two decimal places. Use its native unstyled form or render state
`percentage`, `setPercentage`, `effectiveLabel`, `save`, `isPending`, `error`,
and `message` to supply styled controls. The backend must verify ownership and
resolve price overrides before product overrides and plan defaults. The example
uses the current subscription price on renewals and preserves settled economics.

## Percentage or fixed affiliate payouts

`AffiliatePayoutEditor` is the unstyled editor used inline by the example's seller
product and price rows and admin store-plan rows. Supply `scopeKey`, nullable
`affiliateBasisPoints`, optional nullable `affiliateFixedAmount`, effective values,
`version`, `currency`, and `onSave`. Fixed amounts are major currency units,
not cents. The save callback receives both nullable fields and `expectedVersion`;
only one payout field is non-null. Blank means inherit; explicit zero disables.

The native form includes a number input, `%`/currency-symbol toggle, Save, and X.
X saves null for both fields to clear the override. `currency` defaults to USD
and controls the display symbol. A render prop exposes `value`, `mode`, `setValue`,
`setMode`, `currencySymbol`, `effectiveLabel`, `save`, `clear`, `isPending`, `error`,
and `message` so applications can supply their own markup. Server code must
resolve defaults, validate ownership and versions, convert major amounts into
Stripe minor units, and cap fixed payouts at proceeds after fees. The example
uses a nominal fixed amount per sale currency; it does not perform FX conversion.

Affiliate payout sources can be `global`, `store`, `plan`, `product`, `price`, or
`none`. Unset app rules fall back to zero. The example resolves price → product →
store-wide → plan → platform-wide → 0, and distinguishes explicit zero from null
inheritance. Both global controls use the same package editor as the row controls.

`AffiliatePayoutEditor` also exposes an optional `affiliateCommissionTerm`
(`"forever"`, `"one_time"`, or `null` to inherit) and
`effectiveCommissionTerm`. Its render state includes `term` and `setTerm`, and
`onSave` receives the selected term together with the payout amount. Clear
removes both overrides. The example saves the resolved subscription term in
Stripe metadata at checkout and claims the first paid invoice atomically in its
Convex ledger; the UI component does not itself create transfers or process
renewals.

### Balance funding server adapter

`BalancePaymentSource` and `useBalanceFunding` call host-owned authenticated
callbacks. Their server adapter can now use the client's
`prepareBalanceFunding` and `setBalanceFunding` operations. Persist the immutable
restoration record and explicit consent before enabling, serialize operations per
subscription, and retain request identities through retries. Opt-out restores the
original method and types; it does not retry an unpaid invoice or automatically
fall back to a card. The example demonstrates durable preparation and pending
operation records in `storeBalanceFunding.ts` with a separate preview client.
See the [README balance-funding workflow](../README.md#optional-balance-funded-subscriptions).
