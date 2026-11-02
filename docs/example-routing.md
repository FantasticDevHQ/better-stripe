# Example routing

The Vite example uses TanStack Router without TanStack Start. The code-based
route tree in `example/src/router.tsx` registers every existing URL under one
layout. `App.tsx` mounts its `RouterProvider`; Convex and theme providers remain
in `main.tsx`. The published SDK, React workflows and testing exports do not
import the example router.

Use TanStack `Link` and `useNavigate` with a route path and a separate `search`
object. `RoutePath` derives from the registered tree and types sidebar/command
menu destinations. `NavigationLink` keeps sidebar matching pathname-only and
exact where requested. Ordinary navigation clears query state; tab changes
retain the other query keys. Integration and checkout selection replace history;
seller account section selection pushes history.

## Route inventory

| Access                       | URLs                                                                                                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public storefront            | `/`, `/stores`                                                                                                                                                                         |
| Customer or visitor checkout | `/checkout`                                                                                                                                                                            |
| Public return page           | `/checkout/status`                                                                                                                                                                     |
| Customer                     | `/dashboard`, `/dashboard/billing`, `/dashboard/invoices`, `/dashboard/payment-methods`                                                                                                |
| Seller                       | `/seller`, `/seller/sales`, `/seller/plan`, `/seller/payouts`, `/seller/disputes`, `/seller/refunds`, `/seller/products`, `/seller/account`, `/demo/subscribe`, `/demo/store-earnings` |
| Affiliate                    | `/affiliate`, `/affiliate/sales`, `/affiliate/links`, `/affiliate/payouts`                                                                                                             |
| Admin                        | `/admin`, `/admin/store-plans`, `/admin/products`, `/admin/subscriptions`, `/admin/webhooks`, `/admin/affiliate-recovery`, `/admin/testing`, `/admin/setup`                            |
| Shared demos                 | `/demo/affiliate-recovery`, `/demo/metered-usage`, `/demo/allocation`                                                                                                                  |

`/marketplace/split` replaces itself with `/stores`, preserving search parameters.
`/demo/destination-charge` does the same for customer/visitor personas.
`/seller/onboarding` replaces itself with `/seller/account?section=setup`;
`/seller/marketplace-account` uses `section=stripe-settings`. Both preserve other
query state and override an existing section. The existing role guard runs before
legacy redirect components, so a disallowed persona goes to its role home first.

`role-navigation.ts` owns the role policy and menu inventory. `AppShell` guards
the committed route match, rather than the pending browser location, to avoid
rendering an old redirect outlet while navigation is in flight. Persona changes
and seller selection keep their existing provider IDs and remount behavior.
Persona selection is demo UI state, never backend authorization.

## Search contracts

`lib/router-search.ts` supplies the root search validator and custom parser and
serializer. URL values stay strings, including numeric-looking provider IDs,
JSON-looking text, literal Stripe placeholders, plus signs and empty values.
Repeated unknown keys survive tab changes and legacy redirects. Known keys use
the first value, matching the previous `URLSearchParams.get` behavior. Unknown
keys remain inert URL state and never become navigation destinations.

| Keys                                              | Validation and default                                                                                                                        |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `example`                                         | `headless`, `components`, `embedded`, `hosted`; absent/invalid uses the view's default and existing availability fallback                     |
| `checkout`                                        | `embedded`, `custom`, `redirect`, `form`, `payment-intent`; absent/invalid uses embedded; recurring PaymentIntent selection stays unsupported |
| `section`                                         | `details`, `setup`, `stripe-settings`; absent/invalid uses details                                                                            |
| `diagnostics`                                     | `protocol`; absent/invalid shows the normal metered view; still admin-only                                                                    |
| `ref`, `store`                                    | Optional referral code and store account string; no attribution/ownership changes                                                             |
| `priceId`, `product`, `offer`                     | Optional catalog/provider strings; existing lookup and availability checks remain authoritative                                               |
| `session_id`, `purchase_session_id`               | Optional Checkout Session strings; no coercion or synthesized successful payment                                                              |
| `payment_intent`, `charge_id`                     | Optional provider strings; refund and receipt backend checks remain unchanged                                                                 |
| `payment_intent_client_secret`, `redirect_status` | Optional Stripe return strings; neither grants authority nor proves payment                                                                   |

`lib/use-url-search.ts` presents validated state to existing string-based Stripe
views. Writes go through TanStack navigation and the same validator. Search
validation is a UI boundary only. Backend authentication, ownership, money,
currency, request idempotency and payment evidence checks remain unchanged.

## Return URLs and verification

Checkout still returns to `/checkout/status?session_id={CHECKOUT_SESSION_ID}`,
with the existing PaymentIntent return route at `/checkout/status`. Seller plan
checkout retains `/seller/plan?session_id={CHECKOUT_SESSION_ID}`. Marketplace
purchase returns retain `purchase_session_id` on the legacy account URL, which
redirects to the Stripe settings section. Hosted billing keeps its current-page
return URL. External Stripe navigation continues to use the existing SDK or
`window.location` calls; router search state cannot supply an external redirect.

`router-contract.test.tsx` covers all 37 direct routes, four legacy redirects,
query contracts, role guards and Back/Forward. Existing component tests use real
TanStack memory history via `src/test/router.tsx`; receipt, checkout and currency
regressions remain in their owning suites. Run focused tests with one worker and
`NODE_OPTIONS=--max-old-space-size=512`. Run full `pnpm run check:all` on UbiCloud
CI. Anonymous backend browser proof covers local navigation; real Stripe checkout,
portal, onboarding and payment completion require separate sandbox configuration.

References: TanStack's [migration guide](https://tanstack.com/router/latest/docs/how-to/migrate-from-react-router),
[code-based routing](https://tanstack.com/router/latest/docs/routing/code-based-routing),
[search validation](https://tanstack.com/router/latest/docs/guide/search-params), and
[custom search serialization](https://tanstack.com/router/latest/docs/guide/custom-search-param-serialization).
