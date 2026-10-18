# Example UI audit

Every financial/account page has a public React component or workflow hook in
`@fantastic.dev/better-stripe/react`. Native unstyled components implement the
shared workflows. The example binds authenticated Convex queries/actions and
uses render props or companion hooks to apply shadcn styling.

| Example page or adapter                   | Package UI and workflow ownership                                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Home and stores                           | `Storefront`, including store filtering, active catalog prices, purchase actions, and referral attribution                                             |
| Checkout chooser                          | `CheckoutChooser`, `CHECKOUT_OPTIONS`, recurring-product compatibility and selection                                                                   |
| Checkout session / PaymentIntent adapters | `Checkout`, `CheckoutElementsForm`, `PaymentIntentForm`, `CheckoutForm`, `EmbeddedCheckout`, including loading, retry, validation and confirmation     |
| Checkout status                           | `CheckoutStatus`, `PaymentReceipt`, server/webhook confirmation                                                                                        |
| Customer overview                         | `SubscriptionOverview`                                                                                                                                 |
| Customer subscription billing             | `useSubscriptionManager`, `SubscriptionManager`, `BuyerBillingView`, `SubscriptionCard`, `Invoices`, `BillingPortalLink`                               |
| Customer invoices                         | `Invoices`                                                                                                                                             |
| Customer payment methods                  | `usePaymentMethodsManager`, `PaymentMethods`, `PaymentMethodsList`, `AddCardForm`, Stripe providers                                                    |
| Seller overview                           | `PayoutOverview`, `AccountCreateCard`, `ConnectStatusBadge`                                                                                            |
| Seller and affiliate payouts              | `Payouts`, `PayoutHistory`, `PayoutProgress`, `PayoutSettings`, live balances, upcoming date, history and pagination                                   |
| Seller earnings                           | `EarningsSummary`, `PayoutSchedule`, `PayoutHistory`, `earningsFromBalance`, `useWorkflowResource`                                                     |
| Seller sales                              | `Sales`                                                                                                                                                |
| Seller subscriptions                      | `Subscriptions`, `SubscriptionCard`                                                                                                                    |
| Seller and admin products                 | `useProductManager`, `Products`, `PriceCard`, product/price creation, editing and archiving                                                            |
| Seller account details                    | `useAccountManager`, `Account`, `AccountLoginCard`, `ConnectRequirements`                                                                              |
| Seller onboarding / account setup         | `useOnboarding`, `Onboarding`, `AccountCloseCard`, `DEFAULT_CONNECT_COUNTRIES`                                                                         |
| Seller marketplace account                | Account/onboarding hooks, `AccountConfigurations`, `ConnectStatusBadge`, `CheckoutStatus`, shared action lifecycle                                     |
| Seller billing                            | `usePlanBilling`, `BillingPlans`, `EmbeddedCheckout`, `useInvoiceEstimate`, `InvoiceEstimate`, `useBalanceFunding`, `BalancePaymentSource`             |
| Seller refunds                            | `useRefunds`, `Refunds`, `RefundHistory`, `PaymentDetails`, `CostRecovery`                                                                             |
| Seller disputes                           | `useDisputeResponse`, `Disputes`, `DisputesList`, `DisputeDetail`, `EvidenceForm`, `ChargebackLedger`, `CostRecovery`                                  |
| Affiliate earnings                        | `Earnings`, `EarningsSummary`                                                                                                                          |
| Affiliate referred sales                  | `ReferredSales`, store attribution and commission                                                                                                      |
| Affiliate links                           | `useReferralLinks`, `ReferralLinks`, `ClipboardButton`                                                                                                 |
| Seller affiliate payout rules             | `AffiliatePayoutEditor` with amount, percentage/currency mode, inherited term, Save/Clear, and async feedback                                          |
| Admin store plans                         | `PlanPricingEditor` and `AffiliatePayoutEditor`; the app binds Stripe pricing and inherited commission policy                                          |
| Affiliate sales pagination                | `Pagination` and `useCursorPagination`; the backend supplies indexed cursors                                                                           |
| Admin overview                            | `Overview`                                                                                                                                             |
| Admin subscriptions                       | `Subscriptions`, `useSubscriptionFilter`                                                                                                               |
| Admin webhooks                            | `WebhookEvents`, `useWebhookFilters`                                                                                                                   |
| Admin setup                               | `useWebhookSetup`, `WebhookSetup`, `EnvironmentStatus`, `FixtureProgress`, `useTaskRunner`, `StripeSetup`, `ClipboardButton`, shared actions/resources |
| Admin sandbox testing                     | `useTaskRunner`, `SandboxTesting`, `WorkflowTasks`                                                                                                     |
| Legacy affiliate split demo               | `Checkout`, `SplitBreakdown`, `EarningsSummary`, bound package hook factories                                                                          |
| Legacy destination-charge module          | `Checkout`, `ChargeSummary`; the legacy public route currently resolves to the split demo                                                              |
| Integration presentation switch           | `IntegrationSwitch`; only the active view mounts                                                                                                       |
| Connect alternatives                      | `Connect` with account management, onboarding, payments/refunds, disputes, balances, payouts and notifications                                         |
| Styled shared tables                      | `Collection` and domain collections; `WorkflowTable` only maps their state/columns to shadcn                                                           |

The example owns app branding, navigation, theme controls, the persona/store
switcher, route guards, URL state, and styling. It also owns its users and
server bindings, fee plans, referral-share policy, recovery billing rules,
sandbox scenario definitions, and authorization. These are application choices,
not prerequisites imposed by the public React package.

Some examples use companion hooks with styled markup instead of mounting the
native component. That markup changes presentation; the package owns the
workflow state, validation, duplicate-action handling, and async errors. Reusable
native components exist for consumers who do not want to write those renderers.
Connect and hosted Stripe UI remain available only where Stripe supports them.

## Verification

- Public-entry tests render native components without example providers, routing,
  CSS classes, or inline styling and without calling server actions during render.
- Interaction tests exercise native product-price creation, partial refunds,
  balance consent, checkout selection, and other workflow controllers.
- Account changes and duplicate actions have regression tests.
- Browser smoke coverage visits all five personas' pages and the integration views.
- Checkout tests complete referred guest purchases through all five integrations
  in a Stripe sandbox and verify webhook receipts and settlement.
- `pnpm run check:all` enforces all repository gates, including Shadscan at 100.

## Follow-up audit

The final sandbox QA and follow-up audit checked every example route and its
adapters against the public React exports. Checkout delegates through the
session and PaymentIntent adapters. The remaining local state controls the
app's command menu, mobile sidebar, URL parameters, or selected demo price.
Financial actions use package workflow controllers or components.

The follow-up removed payout-status filtering from the example. Both native
`Payouts` and its render-prop example now consume the package's
`upcomingPayouts`, `previousPayouts`, and `nextPayout`. Regression tests cover
mixed payout statuses and arrival ordering. Dispute lists and detail views hide
stale evidence deadlines after a dispute leaves a response-required status.

Live browser checks cover reset/reseed, all persona routes, integration tabs,
five checkout integrations, saved-card add/remove and persistence, product
editing, subscription pause/resume, invoice estimates, balance-payment consent,
affiliate link copying, dispute evidence, and partial/remaining-balance refunds.
The tests use Stripe sandbox objects and await action results or webhook state.
Native public-entry tests also render the workflows without example providers,
CSS classes, inline styles, or example URLs.

## Pricing and affiliate updates

Seller product/price rows, store-wide defaults, admin plan rows, and platform-wide
defaults all use the public `AffiliatePayoutEditor`. It owns percentage/fixed
amount validation, commission-term selection, clear/inherit behavior, edit
versions, pending state, and errors. `PlanPricingEditor` owns the monthly-price
and sale-fee form. The example binds both to Convex functions and supplies shadcn
markup. The host resolves inherited rules, chooses referral attribution and
commission terms, and supplies the resulting policy to the package. BetterStripe
owns financial allocation, transfer execution, replay safety and recovery. These
server responsibilities are detailed in the boundary audit below.

Browser regression checks cover equal cards/layouts in API and package views,
referral-sales pagination, inline payout controls, and plan pricing. Sandbox QA
covers all five checkout integrations, declined-card retries, inherited and fixed
commissions, and Forever/One-time subscription renewals using Stripe test clocks.
Existing subscriptions keep their monthly price and saved commission term.

## Package and example boundary

This source audit covers checkout, catalog, buyer billing, accounts/onboarding,
seller and affiliate reporting, payouts, refunds, disputes, recovery, and setup.
It checks ownership of the implementation; the historical sandbox checks above
are separate evidence, not a claim that every live flow ran again for this audit.

| Concern                 | Package implementation                                                                                               | Example wiring that remains                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Checkout                | `CheckoutChooser`, session/PaymentIntent workflows, email validation and payment confirmation                        | `components/checkout-types.tsx`, session/payment-intent adapters, route selection, buyer/store lookup and referral metadata |
| Catalog and billing     | Product/price controllers, subscription commands, invoice readers, portal creation                                   | Authorized Convex bindings, allowed products, tier names, plan selection and proration policy                               |
| Accounts and onboarding | Account configuration, requirements, onboarding workflows and Connect embeds                                         | Persona/store selection, account ownership and navigation                                                                   |
| Reporting and payouts   | Earnings derivation, currency formatting, payout classification, pagination and payout workers                       | Store/user joins, collection bindings, cron installation and styled rows/cards                                              |
| Refunds and disputes    | Refund commands and observations, evidence controllers, clawback/recovery records and execution                      | Original-owner authorization, source routing, selected liability policy and case links                                      |
| Durable financial work  | `balanceFundingWorkflow`, `costRecoveryWorkflow`, provider execution, stable operation identities and reconciliation | Credential-bearing provider action adapters, consent records, host request status and explicit scheduling policy            |
| Setup and testing       | Reusable task/action state and setup UI                                                                              | Sandbox-only accounts, prices, cards, test clocks, reset/seed orchestration and fixture assertions                          |

### Concrete adapters

- `example/src/components/checkout-form-fields.tsx` renders the package's
  `CheckoutFormState`. It forwards `submit`, input values, pending state and errors.
  It must not confirm a payment or duplicate email validation.
- `example/src/lib/stripe-hooks.ts` binds package hook factories and pagination to Convex
  function references. `current-subscription.ts` and `store-earnings.ts` re-export
  package selectors.
- `example/src/lib/format-amount.ts` re-exports the package's `formatPrice` as a local name.
  Buyer billing, checkout previews and product pickers also use `formatPrice`.
  Seller payout history uses `formatPayoutAmount`, including its explicit fallback
  for unsupported display precision. Currency conversion
  must not assume `amount / 100`; JPY has different units, and observed ISK/UGX
  fractional balances need the package's display rules. Charge eligibility and
  bank-payout eligibility still use their respective package validators.
- `example/convex/storefront/checkout.ts` selects the authorized buyer, seller, eligible
  product and referral policy before calling `stripe.createCheckoutSession`.
  The demo's `avery` code and store-plan metadata are application policy.
- `example/convex/settlement/workflow/actions.ts` and
  `example/convex/sellerCosts/recoveryInvoices/workflow/actions.ts` authorize the original
  host job and pass credentials to `stripe.costRecovery.executeGroupProvider`.
  Provider write/reconciliation behavior stays in the package.
- `example/convex/storeBalance/workflow/internal/actions.ts` joins the seller's consent and
  request to package preparation/apply operations. Its bounded observation cadence
  and host status projection remain local. It uses `financialRetryDecision` and
  does not reinterpret an unknown provider write as success.
- `example/convex/sellerCosts/invoiceRecoverySource.ts` and `unsettledCostSource.ts` read
  provider objects to find the demo's original recovery group or store sale. Their
  `example:store:*` and `sale_v1` bindings are application-specific. Package
  reconciliation still verifies funding and allocations before moving money.

### Rules for changes

Add a reusable Stripe protocol, monetary validator, workflow controller, pagination
controller or unstyled renderer under `src/client`, `src/component` or `src/react`.
Expose it through the appropriate public entry point and test it without example
personas, routes or schema. Use it from the example through a small binding or
render-prop adapter. Different integration tabs may have different markup, but
should share package-owned validation, units and action state.

Keep authentication, ownership checks, business policy and application joins on
the host server. A component ID, account ID, role switch or metadata field never
authorizes a caller. The demo's identity model is not production authentication.
Do not move store/user tables or sandbox fixture orchestration into the package
just to reduce the example's line count.

Payment acceptance and fulfillment are separate responsibilities. BetterStripe
supplies verified payment records and hooks; the consuming application decides
whether payment unlocks a file, account access, a license or another benefit.
It must make those effects idempotent and choose its refund/access policy. The
example should not grow a download service, entitlement engine or shipping system.
