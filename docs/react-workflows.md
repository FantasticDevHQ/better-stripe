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

The Vite refund history is a bounded preview of up to 25 loaded rows, not an
authoritative account total. `groupRefundPreview(rows)` groups only supplied rows
by original currency and exact provider status, returning currency, status, nullable
amount and row count. It never adds currencies or combines pending/failed/canceled
requests with succeeded refunds. An empty preview has no monetary group; an explicit
zero remains zero. Invalid or unsupported units and unsafe sums yield an unavailable
group amount instead of a rounded or invented total.

`formatRefundAmount(amount, currency, locale?)` returns a nullable display string
using package ordinary provider-unit helpers. It preserves observed fractional
ISK/UGX refunds; display does not establish eligibility for a new partial input.
The native `RefundHistory` and the Vite render-prop table use this safe formatter.
Both helpers are public through `/react`, allowing Dojo to supply translated
Shadcn labels and empty/unavailable states without rebuilding financial arithmetic.
Preview grouping performs no reads, writes or provider operations and cannot prove
bank delivery or complete-account earnings. Authorize and bound the source read in
the host; keep authoritative full-account aggregates separate.

### Complete refund history (added after 0.16.0)

`BetterStripe.paginateRefunds(ctx, opts)` reads authoritative synchronized component
refund records. `RefundPageOptions` is exported from the main package entrypoint.
Pass `paginationOpts: { numItems, cursor }` with an integer page size from 1 to 100
and `null` for the initial cursor. The result has `page`, `isDone` and
`continueCursor`; feed the returned cursor into the next request until `isDone`.
Each request performs one bounded helper-compatible component paginate operation
in newest-first order. Bind the authorized host query with the package React
`useComponentPaginatedQuery`, matching the catalog and payout readers. Pinned
ranges may grow beyond the requested page size; reads cap at 200 rows or 1 MB
and return split hints for the hook. Existing `listRefunds` retains its
capped-array compatibility.

The host must authenticate the session and derive an authorized account/payment
scope before exposing this method through its reactive query. Optional
`stripeAccountId`, `stripePaymentIntentId` and `status` filters all apply together;
a mismatched account/payment pair returns no records. Do not expose an unscoped
reader to ordinary sellers, trust browser-supplied account IDs or treat this
component API as an authentication boundary.

Render returned records with `RefundHistory` or its render prop, retaining their
original amount, currency, status and charge/payment identifiers. Dojo supplies
translated Shadcn presentation and its application audit context. Loaded pages
and the existing 25-row Vite preview are incomplete until pagination finishes;
neither is a monetary aggregate. Grouped preview amounts remain explicitly
bounded, and authoritative monetary totals require currency-isolated aggregate
APIs. This reader performs no Stripe request, refund or ledger write.

This method is absent from public 0.16.0. Source acceptance does not publish it.
Host applications must wait for a separately verified published artifact and
package adoption before importing it; source merges alone do not satisfy that
consumer gate.

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

## Dispute evidence uploads and onboarding navigation

`EvidenceUpload` is an unstyled control with render props. Its `scopeKey` must
include the authenticated scope and selected dispute. Bind `onUpload(file)` to
an authenticated server callback, convert the file to bytes there, and call
`betterStripe.uploadDisputeEvidence(ctx, { stripeDisputeId, actor, field, file })`.
The example seller disputes page demonstrates a communication-file attachment.
The example uses demo personas, so production applications must replace its
persona authorization with a session-derived actor and dispute ownership check.
Never accept an actor, connected request account, or attachment file ID from the
browser as authorization.

The server API accepts nonempty PDF, JPEG or PNG bytes up to 5,000,000 bytes. MIME
type and file signature must match. Stripe performs full document validation and
may reject corrupt documents or apply additional dispute/network limits. See
[Stripe's file upload guide](https://docs.stripe.com/file-upload) and
[evidence troubleshooting](https://support.stripe.com/questions/evidence-submission-troubleshooting-faq).
Authorization runs before uploading and again before binding. The API uploads
with `purpose: "dispute_evidence"`, binds only the returned ID to the chosen
file evidence field, and explicitly sends `submit: false`. Uploading never sends
evidence to the bank. Continue using `EvidenceForm.stage()` for prose drafts and
`EvidenceForm.submit()` for explicit final submission.

`DISPUTE_UPLOAD_FAILED` carries structured provider error details. An attachment
failure reports `DISPUTE_UPDATE_FAILED`; the uploaded file can remain at Stripe
without a draft attachment. Keep the local file and prose draft so the user can
retry. Do not mark an upload as attached until the entire callback succeeds.
Convex action payload limits can be lower than Stripe's file limit. For larger
files, authorize and load a private storage reference on the server, then pass
its bytes to the package. The example byte-action transport is for small files.

`useWorkflowAction(action, scopeKey, onSuccess)` invokes `onSuccess` only after
checking that the response still belongs to the mounted scope. `useOnboarding`
uses this lifecycle for both create and continue navigation, including its
`window.location.assign` fallback. An old response cannot navigate after unmount
or scope replacement. Current requests preserve shared pending locks and errors.
`uploadDisputeEvidence`, `EvidenceUpload` and the onboarding navigation fix shipped
in [0.14.0](https://github.com/FantasticDevHQ/better-stripe/releases/tag/v0.14.0).
Version 0.13.0 does not contain them. Consumers must upgrade to
`@fantastic.dev/better-stripe@0.14.0` or later before using the upload API or relying
on the package's navigation guard.
Production storage, session authorization, styling, translations and extended
hosted onboarding verification remain application responsibilities.

## Save a card through SetupIntent confirmation

`SaveCard` provisions a customer-bound SetupIntent through an authenticated
`createSetupIntent({ requestId })` callback and mounts Payment Element. It keeps
creation retries on the same request, blocks duplicate confirmation, exposes
failures and only calls `onSuccess(setupIntentId)` after Stripe reports
`succeeded`. Stripe.js handles required authentication and redirects.

```tsx
<SaveCard
  publishableKey={publishableKey}
  scopeKey={`${authenticatedUserId}:${customerAccount}:off_session`}
  requestId={persistedSaveRequestId}
  returnUrl="https://app.example/billing/cards"
  createSetupIntent={createAuthorizedSetupIntent}
  onSuccess={refreshPaymentMethods}
/>
```

The host callback calls `stripe.createSetupIntent(ctx, { userId,
customerAccount, usage: "off_session", consent: true, idempotencyKey })` with
server-resolved values. Record consent to the selected usage before mounting
this workflow. The default confirmation checkbox separately grants permission
to save and redisplay the card, sent as `allow_redisplay: "always"`. Use
`renderForm` for your own disclosures, consent copy, Payment Element, pending
state and errors. `useConfirmPayment().confirmSetup(returnUrl, allowRedisplay)`
supports `always`, `limited` and `unspecified` when a different redisplay policy
is required. Off-session usage does not guarantee that future payments will
never require authentication.

Persist the logical request and immutable customer/usage scope server-side.
`requestId` and `scopeKey` isolate UI lifecycles; they do not authorize access.
Handle redirect returns by retrieving the SetupIntent through an authenticated
server adapter and checking ownership and status before displaying completion.
Do not infer success from a URL parameter. Do not attach the confirmed method
again or treat confirmation as changing a subscription default.

Existing `AddCardForm` and `PaymentMethods` tokenization/attach integrations remain
available. Tokenization plus attachment does not complete SetupIntent or SCA
verification.

### Live authentication and reuse results, 2026-10-15

The public `SaveCard` workflow and `BetterStripe.createSetupIntent` /
`BetterStripe.createPaymentIntent` methods were exercised against real Stripe.js
and Stripe test APIs at commit `332d49c`, merged in
[PR #166](https://github.com/FantasticDevHQ/better-stripe/pull/166).
The Connect-enabled sandbox used `2026-09-30.endive` for browser confirmation.
Separate API checks also passed on `2026-09-30.preview`.

| Check                                                                | Observed result                                                                                                                                                                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explicit consent and repeated provisioning with the same request key | Off-session setup accepted; retries returned the same intent.                                                                                                                         |
| Card `4000000000003220`, failed 3DS challenge then retry             | A retryable authentication error appeared. Retrying the same SetupIntent and completing 3DS succeeded. Stripe SetupAttempts recorded both outcomes.                                   |
| Card `4000002500003155`, setup then later off-session payment        | 3DS setup succeeded with `usage: "off_session"` and `allow_redisplay: "always"`. The saved method belonged to the expected V2 customer; the later payment succeeded and was refunded. |
| Later off-session reuse of card ending `3220`                        | Stripe returned `authentication_required`. Successful setup does not guarantee every later payment can avoid authentication.                                                          |
| API decline and payment retry checks                                 | Decline returned `card_declined` / `requires_payment_method`; same-key payment provisioning returned the same intent.                                                                 |

Use these public test card numbers only in a Stripe test payment form, with a
future expiration and test CVC. Use Stripe's test PaymentMethod IDs for API tests.
See [Stripe's testing guide](https://docs.stripe.com/testing#regulatory-cards).

[Uploaded screenshots and provider records](https://github.com/FantasticDevHQ/better-stripe/pull/166#issuecomment-6185124292)
show the challenge, retryable failure and successful reuse. No continuous video
was recorded. Test payments were refunded and disposable fixtures cleaned up.
The test used a local ownership fixture for the host callback. It verifies package
orchestration and actual provider authentication, not production application
authentication, redirect-return recovery, webhook delivery or Dojo's saved-card UI.
Consumer applications still need to verify their own authenticated adapters and saved-card UI.
See [sandbox setup findings](accounts-v2-preview.md#connect-sandbox-setup-findings-2026-10-15)
for the account eligibility requirement.

## Combined automatic payout progress

`PayoutProgress` is an unstyled, read-only view of a custom recipient's combined
eligibility assessment. Load the policy and
[preview](settlement.md#payout-eligibility-preview) through an authorized server
adapter. Derive independent liabilities on the server. Read the worker's next
attempt separately from the provider's actual bank arrival dates.

```tsx
import { PayoutProgress } from "@fantastic.dev/better-stripe/react";

<PayoutProgress
  policy={policy}
  preview={preview}
  currency="usd"
  nextAttemptAt={job?.nextAttemptAt}
  locale="en-US"
  timeZone="UTC"
/>;
```

The default markup uses a single accessible progress indicator, financial
metrics, source contributions and assessment/attempt/deadline dates. Store and
affiliate contributions share one minimum. Pending credits are separate, shared
costs reduce the combined entitlement once, and negative entitlement remains
visible even though the visual progress indicator stops at zero. A qualified
assessment is informational; the automatic worker verifies it again before a
payout. The component has no withdrawal action.

When the assessment includes `accounting`, the component also shows carried
forward funds, funds withheld for costs, in-flight allocations and paid principal
net of verified payout returns. Its source table separates in-flight and paid
amounts. These metrics are omitted for older assessments without accounting
fields. They are never inferred from the current Stripe available balance.

`policy={undefined}` means loading. A null policy or `stripe_managed` mode shows
Stripe-managed defaults without inventing a numeric provider floor. Changing
policies suppress prior financial progress during activation, opt-out and expiry
restoration. A policy preserves its prior mode until confirmation, so mode alone
does not establish verified controls while status is `changing`.
During the final day, an assessment with `minimumWaived` explains that only the
application minimum is waived; its saved threshold remains visible, and the
minimum progress bar is omitted. Stripe limits and balance checks still apply.
Hosts that project a policy into a public DTO must forward its optional
`holdingExpiry` field. Use the package's `payoutHoldingExpiryValidator` for that
nested field rather than copying its schema. Omitting it would hide unresolved
recovery after automatic scheduling is restored.

A policy with unresolved `holdingExpiry` shows recovery status even after
`mode` becomes `stripe_managed`. `state.recovery` supplies per-currency provider
balance labels and raw values from the last recovery check. These balances are
not payable earnings. An unavailable observation has no balance rows, rather
than fabricated zero. Pending controls still take precedence. The default
component and example show the original deadline and recovery check time.
An expired assessment explains the holding deadline and withholds financial
progress until the schedule is restored and verified.
For a ready custom policy, an
undefined preview means loading; a null or minimal held preview shows an
unavailable assessment rather than fabricated zero balances. A mismatched
currency or configured minimum rejects the display.

Use the `children` render prop for translated labels and application cards. It
receives `status`, `reason`, `metrics`, `sources`, `progress`, `observedAt`,
`nextAttemptAt`, `holdDeadline` and optional `accounting`. Accounting metric keys
are `carried`, `withheld`, `reserved` and `released`. Metrics include raw minor-unit
amounts as well as formatted values. Render props use the same state calculation
as the native markup; replace the English message with your own translated copy
selected by `status` and `reason`.

Scope and refresh the host data when the recipient or settlement currency
changes. Keep currencies separate. This display does not configure policies,
install a scheduler or bypass the release API's capability/history limits.

## Payout settings

`PayoutSettings` and `usePayoutSettings` own minimum entry, explicit custom-hold
consent, loading/error states and callback locking. They never create a payout.
`onSave` receives `{ currency, mode, expectedRevision, minimum?, consent }`.
The minimum uses ordinary Stripe currency units. No provider floor is guessed.
The host must derive the authenticated account/owner, preserve the policy's
other currency minimums, and call `payoutPolicy.prepare` and `apply` with a
stable immutable operation identity. Return `{ status, reason? }`; supported
statuses are `ready`, `unsupported`, `migration_required`, `schedule_drift` and
`canceled`.

When a provider outcome is unknown, refresh the policy instead of inventing
success or creating a new operation. `onRetry` resumes the server's stored
pending operation; the installed recurring job also resumes it. The editor
locks changes while `policy.status` is `changing`. Render props expose the same
state for translated forms and design-system controls.

The example's `recipientPayoutPolicy` actions bind the demo user to its account
server-side and derive uncollected seller costs through the same query as the
worker. They preserve other currencies, replay stored changes without rolling
back newer settings, and restore the original schedule on opt-out. The public
`payoutPreviewValidator` lets the host validate the package assessment without
copying its return schema. Production apps must replace demo persona selection
with authenticated ownership; the demo is not evidence of production auth.

Custom schedules affect the entire recipient account. Configure each settlement
currency. Choosing Stripe-managed mode restores the original schedule for all
currencies and removes application minimums. Funded accounts needing historical
adoption show `migration_required`; this form does not guess their source
allocations or automatically adopt unallocated money. Install worker recovery
and deadline-expiry jobs before exposing activation, and use the reset guard
described in the [settlement guide](settlement.md#development-reset-safeguards).

## Component history and currency summaries

See the [read contract guide](read-contracts.md) for reactive product, price and payout
cursors, exact currency summaries, legacy backfill, payout failure details, and
published-version adoption requirements.
