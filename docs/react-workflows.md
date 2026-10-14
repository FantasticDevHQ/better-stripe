# React workflows

Import the example's reusable UI and workflow hooks from
`@fantastic.dev/better-stripe/react`. You do not need the example's route tree,
role provider, Tailwind, or shadcn components.

Components render semantic HTML without package CSS. Use their render props or
companion hooks to supply your own design system. Stripe iframe contents use
Stripe's `appearance` options and retain Stripe's own styling.

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
request ID for server idempotency. A user-triggered retry creates a new request
ID; also enforce application-level duplicate-order protection on the server.

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

## Headless or Stripe embedded

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
| Refunds               | `Refunds`, `RefundHistory`                                                                                     | `useRefunds`, `parseAmountCents`                                             |
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
