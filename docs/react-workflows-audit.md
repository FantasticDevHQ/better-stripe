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
| Seller and affiliate payouts              | `Payouts`, `PayoutHistory`, live balances, upcoming date, history and pagination                                                                       |
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
markup. Rule resolution, Stripe metadata, first-invoice claims, fee accounting,
and transfer execution remain backend application policy.

Browser regression checks cover equal cards/layouts in API and package views,
referral-sales pagination, inline payout controls, and plan pricing. Sandbox QA
covers all five checkout integrations, declined-card retries, inherited and fixed
commissions, and Forever/One-time subscription renewals using Stripe test clocks.
Existing subscriptions keep their monthly price and saved commission term.
