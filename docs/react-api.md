# React API reference

## React Hooks

Import from `@fantastic.dev/better-stripe/react`. All hooks use Convex's `useQuery` and `useMutation` internally.

Read hooks are exported as factory functions that take the app's `useQuery` binding and a query function reference, allowing them to work with any component registration name. Hooks that take a single ID argument accept `undefined` and skip the query (via Convex's `"skip"` sentinel) until the ID is available.

### Read Hooks

| Hook Factory                    | Hook Arguments                             | Returns                                                                                                            |
| ------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `createUseAccount`              | `(userId?)`                                | `{ account, isLoading }`                                                                                           |
| `createUseProducts`             | `({ accountId?, active? }?)`               | `{ products, isLoading }`                                                                                          |
| `createUsePrices`               | `(productId?)`                             | `{ prices, isLoading }`                                                                                            |
| `createUseSubscription`         | `(subscriptionId?)`                        | `{ subscription, isActive, isTrialing, isCanceling, daysUntilRenewal, daysUntilTrialEnd, isLoading }`              |
| `createUseSubscriptions`        | `({ userId?, status? }?)`                  | `{ subscriptions, activeSubscription, isLoading }`                                                                 |
| `createUseCheckout`             | `(sessionId?)`                             | `{ session, status, isComplete, isLoading }`                                                                       |
| `createUsePaymentMethods`       | `(accountId?)`                             | `{ methods, defaultMethod, isLoading }`                                                                            |
| `createUseInvoices`             | `({ userId?, subscriptionId?, status? }?)` | `{ invoices, isLoading }`                                                                                          |
| `createUseAccountOnboarding`    | `(accountId?)`                             | `{ account, status, isReady, missingRequirements, isLoading }`                                                     |
| `createUseEarnings`             | `(accountId?)`                             | `{ gross, reversed, net, payouts, paidOut, transfers, isLoading }` — recipient balance/earnings                    |
| `createUseSplitBreakdown`       | `({ sourceChargeId?, saleAmount? })`       | `{ breakdown: { legs, store, affiliate, other, recipientsTotal, platform? } \| null, isLoading }` — per-sale split |
| `createUseDisputes`             | `({ accountId?, status? }?)`               | `{ disputes, isLoading }`                                                                                          |
| `createUseDisputeWithCountdown` | `(stripeDisputeId?)`                       | `{ dispute, countdown: { dueBy?, daysRemaining?, isOverdue } \| null, isLoading }`                                 |

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
} from "@fantastic.dev/better-stripe/react";

<CheckoutSessionProvider publishableKey={pk} clientSecret={token}>
  <MyForm />
</CheckoutSessionProvider>;

function MyForm() {
  const checkout = useCheckoutSession();
  if (checkout.type !== "success") return <Spinner />;
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

Import from `@fantastic.dev/better-stripe/react`. The package includes the
example's reusable checkout, payouts, refunds, disputes, accounts, onboarding,
products, subscriptions, billing, referrals, and admin/setup workflows.

Use native unstyled markup, render props, or companion hooks with your own
design system. Bind authenticated server callbacks and query data in your app.
Supported workflows can select Stripe Connect embedded presentation; checkout
supports five integrations. No example router, persona provider, or CSS is required.

See [the React workflow guide](react-workflows.md) for usage, the full
component/hook matrix, styling, data contracts, and Stripe integration limits.
Existing low-level components remain available below. Props vary by component;
Stripe iframe styling uses `appearance`, while custom markup uses render props
or the low-level component's `className`/label props.

### Hosted onboarding navigation

Since 0.14.0, `Onboarding` and `useOnboarding` suppress hosted navigation from
create/continue responses after unmount or authenticated scope replacement.
Current-scope responses still navigate through `onNavigate` or the default
`window.location.assign`. Shared pending locks, duplicate-submit prevention and
error state remain intact. Set `scopeKey` to identify the authenticated
account/resource; it controls lifecycle isolation and does not authorize access.
See the [workflow guide](react-workflows.md#dispute-evidence-uploads-and-onboarding-navigation).

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
| `SubscriptionActions`   | Cancel/reactivate action buttons (status-aware)           |

### Payment Methods

| Component                   | Description                                        |
| --------------------------- | -------------------------------------------------- |
| `AddCardForm`               | Headless add-payment-method form                   |
| `PaymentMethodsList`        | Saved payment methods list with render props       |
| `DeletePaymentMethodDialog` | Remove payment method (app provides dialog chrome) |
| `PaymentMethodActions`      | Per-method set-default/delete actions              |

### Buyer Billing

| Component          | Description                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `BuyerBillingView` | Per-store buyer billing view: subscriptions grouped by store, reusable saved card, embedded card update |

An embedded-only billing surface for buyers: their subscriptions are grouped by
store (each store scoped via the `listSubscriptionsByUserAndStore` /
`groupSubscriptionsByStore` per-store queries) with per-store cancel/reactivate,
alongside the ONE saved payment method that is reusable across every store. The
card is updated in place via an embedded `AddCardForm` slot — no redirect.

```tsx
import {
  BuyerBillingView,
  AddCardForm,
  StripeProvider,
} from "@fantastic.dev/better-stripe/react";
import { groupSubscriptionsByStore } from "@fantastic.dev/better-stripe";

function BuyerBilling({ userId, customerAccount }: Props) {
  const subscriptions = useQuery(api.stripe.listSubscriptionsByUser, {
    userId,
  });
  const { defaultMethod } = usePaymentMethods(customerAccount);
  const cancel = useMutation(api.stripe.cancelSubscription);
  const reactivate = useMutation(api.stripe.reactivateSubscription);

  return (
    <BuyerBillingView
      // groupSubscriptionsByStore reused, not recomputed
      subscriptions={subscriptions?.map((s) => ({
        ...s,
        id: s.stripeSubscriptionId,
      }))}
      paymentMethod={defaultMethod}
      isLoading={subscriptions === undefined}
      onCancel={(sub) => cancel({ stripeSubscriptionId: sub.id })}
      onReactivate={(sub) => reactivate({ stripeSubscriptionId: sub.id })}
      updateCardSlot={
        <StripeProvider publishableKey={pk}>
          <AddCardForm onSuccess={handleCardSaved} />
        </StripeProvider>
      }
    />
  );
}
```

### Connect and Marketplace

| Component                 | Description                                   |
| ------------------------- | --------------------------------------------- |
| `ConnectStatusBadge`      | Connect verification status badge             |
| `AccountOnboardingCard`   | Connect onboarding progress display           |
| `AccountOnboardingButton` | Continue onboarding action (status-aware)     |
| `AccountCreateCard`       | Create Connect account card                   |
| `AccountCreateButton`     | Create account action with loading state      |
| `AccountLoginCard`        | Login to Connect dashboard card               |
| `AccountLoginButton`      | Dashboard login/open action                   |
| `AccountCloseCard`        | Close/restart account card (status-aware)     |
| `AccountCloseButton`      | Close/restart action with status-aware labels |
| `ConnectRequirements`     | Missing requirements checklist                |

### Payouts and Earnings

Use React's `formatPayoutAmount(amount, currency, locale?)` when rendering
observed ordinary Stripe balances and payouts. It preserves supported currency
units, including JPY and fractional ISK/UGX compatibility values. Unknown
precision is shown explicitly as raw minor units with `display unavailable`.
This display helper does not establish payout eligibility or Global Payouts
currency support. See the [React workflow guide](react-workflows.md).

| Component         | Description                                                                                                                                                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PayoutSchedule`  | Recipient balance + next-payout display, fed by a `balance` snapshot and `listPayouts` rows. Payouts are automatic/rolling — no manual-withdrawal action is offered.                                                                                      |
| `EarningsSummary` | Gross / reversals & adjustments / net + latest payout, fed by `useEarnings(accountId)`. Reversals cover both deferred fee collection and refund/dispute clawbacks — not a pure fees figure, hence the "Reversals & adjustments" label rather than "Fees". |
| `SplitBreakdown`  | Per-sale store / affiliate / other / platform split lines, fed by `useSplitBreakdown`. The platform line reads "unknown" (not $0) when the hook wasn't given the sale amount.                                                                             |

### Disputes (headless)

The app-owned alternative to [Embedded Disputes](#embedded-disputes-stripe-connect) below — build a custom dispute UI on the read hooks and these components instead of Stripe's hosted ConnectJS components.

| Component        | Description                                                                                                                                                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DisputesList`   | Sorted-by-deadline dispute list (soonest evidence due-by first, no-deadline last), fed by `useDisputes`                                                                                                                                            |
| `DisputeDetail`  | Amount, reason, status, evidence-due countdown, and linked transfers for one dispute, fed by `useDisputeWithCountdown`                                                                                                                             |
| `EvidenceUpload` | Since 0.14.0: unstyled file-selection, pending, failure and retry control with render props; bind `onUpload(file)` to an authenticated server adapter that attaches to a draft                                                                     |
| `EvidenceForm`   | Plain-language evidence form (product description, access activity, additional info, customer communication) that maps through `buildDisputeEvidence` before calling an app-wired `onUpdateDispute`; `stage()` saves a draft, `submit()` finalizes |

### Embedded Disputes (Stripe Connect)

The Stripe-hosted alternative to the headless dispute components: each seller
views and responds to their own disputes via Stripe's embedded `disputes_list`
/ `payment_disputes` components, driven by the Account Session that
`createDisputeSession` creates.

| Component          | Description                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `ConnectProvider`  | Initializes ConnectJS with your publishable key + an account-session fetcher                    |
| `EmbeddedDisputes` | Mounts the embedded `disputes_list` (or `payment_disputes` when scoped via `payment`) component |

**Dependencies:** the wrapper uses [`@stripe/react-connect-js`](https://www.npmjs.com/package/@stripe/react-connect-js) and [`@stripe/connect-js`](https://www.npmjs.com/package/@stripe/connect-js), which ship as regular dependencies of this package (same convention as `@stripe/react-stripe-js` / `@stripe/stripe-js`) -- no extra install step. ConnectJS components are client-only iframes; render them in client components.

```tsx
// convex/stripe.ts — expose the account session (server side)
export const createDisputeSession = action({
  args: { stripeAccountId: v.string() },
  handler: async (ctx, args) => stripe.createDisputeSession(ctx, args),
});

// Seller disputes page (client side)
import {
  ConnectProvider,
  EmbeddedDisputes,
} from "@fantastic.dev/better-stripe/react";

function SellerDisputes({ stripeAccountId }: { stripeAccountId: string }) {
  const createSession = useAction(api.stripe.createDisputeSession);
  return (
    <ConnectProvider
      publishableKey={import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY}
      fetchClientSecret={async () =>
        (await createSession({ stripeAccountId })).clientSecret
      }
    >
      <EmbeddedDisputes />
    </ConnectProvider>
  );
}
```

## Metered billing

See [reusable metered billing UI](usage-react.md) for `UsageBilling`, `UsageSummary`, `UsageAllowance`, `UsageCredits`, `UsageHistory` and their hooks.

See [native usage configuration UI](usage-configuration.md) for `UsageConfiguration`, `useUsageConfiguration` and `UsagePriceRow`.
