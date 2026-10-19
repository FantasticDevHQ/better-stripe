# Attach metered billing to products

The example at `/demo/metered-usage` connects native Stripe metering to the same
catalog products that sellers and admins manage elsewhere in the app. It uses the
public BetterStripe APIs and React workflows. No Metronome account is required.

## Try Maya's coaching membership

1. Start the example with the [setup guide](metering-setup.md). Choose Seller and
   Maya's Fitness Studio, then Metered billing. Maya has metered billing enabled
   by default. Sasha's Ceramics starts disabled and continues selling its regular
   products without usage charges.
2. Select an existing product, or create **Fitness Coaching Membership** under
   Products. Each product row links to its metered billing settings.
3. Choose Included monthly usage. The example defaults to a **USD 20 monthly
   base fee, 60 coaching minutes included per billing period, then USD 1 per
   extra minute**. Adjust the terms before attaching them.
4. Compare **via API** and **BetterStripe components**, then Attach billing to
   product. Both create the same server-authorized product offering. The server
   pins the original product, configuration, meter and prices. Once attached,
   terms are read-only in both views. Create another product for different terms;
   this example does not migrate existing subscribers to a new price.
5. Choose Customer. The store lists the membership with its base fee, included
   minutes and overage rate. Review membership opens Your metered services.
   Subscribe to this product creates or resumes the original Stripe Checkout.
   Seed the example's customer accounts in Admin → Setup first if they are missing.
6. Open Stripe Checkout and pay with test card `4242 4242 4242 4242`, a future
   expiry and any test CVC. Return to Metered billing and Refresh enrollment.
   Checkout redirects and an `active` subscription alone do not authorize work.
7. Complete a coaching session with its actual number of minutes. For example,
   75 minutes consumes the 60 included minutes and records 15 overage minutes.
   The package reserves allowance, records usage and commits the example's
   completed-session marker in one Convex mutation. Delivery runs afterward.
8. Compare the headless usage/history UI with `UsageBilling` and `UsageHistory`.
   Accepted usage is an estimate; native aggregation can lag. Overage appears on
   Stripe's monthly invoice, separately from the monthly base fee. Preview next
   invoice reads Stripe's current draft estimate, including the fixed fee. Cancel
   renewal stops the next renewal while retaining the original current period,
   usage history and any unused credit liabilities.

The new product flow reuses the customer's existing, server-linked Accounts v2
account from the example's account setup and its original
subscription periods. It does not create a new payer or test clock for every
visit, advance shared customers into the future, or archive shared products.
The original checkout intent is reused across integration views and retries.
A failed coaching request keeps its original identity and quantity in the tab's
session storage so a reload can retry it without accepting new units. This is a
demo convenience, not authorization. External coaching or report services still
need their own durable idempotent work protocol.

## Admin and store access

Admin → Metered billing contains independent **Store access** controls and
**Platform service products**. Enable Sasha only when that store needs metered
products. Server-side checks enforce store enablement and original product
ownership; the browser cannot grant itself access.

Disabling a store stops new configuration and new enrollment intents. Pending
unpaid checkout creation/resumption is blocked while disabled. An already paid,
original Checkout can still be reconciled. Existing purchased subscriptions keep
serving their original terms and retain their usage/history. Disabling is not
cancellation or a refund, and does not retire shared Stripe resources.

An admin configures the platform's own products. A seller configures only its own
products. Admins enable stores separately; enabling a store does not change its
prices or subscribe anyone.

## Pay as you go

Create a separate Maya product such as **Additional coaching minutes** and choose
Pay as you go. Set the monthly base fee to zero and the unit price to USD 1 per
minute. Customers enroll through Checkout, then record completed coaching
minutes. Stripe bills the units at the end of the native monthly period.
A positive base fee is also supported and shares the metered subscription.

## Paid prepaid credits

For the platform, create a product such as **Store analytics reports**. Choose
Admin → Metered billing → that platform product → Prepaid credits. The example
uses report units, USD 1 per report and a manual package of ten credits.

Choose Customer and Enroll in report service first. Prepaid enrollment uses
`usage.ensureSubscription` with `send_invoice` collection and a 30-day due
window. It does not use automatic-collection Checkout. Work remains gated by
verified credit backing, and enrollment alone collects no cash. Try generating a
report before funding, then Buy report credits with test card. That explicit
button confirms Stripe's synthetic Visa on the server. The package verifies the
original captured payment and paid credit grant before credits become ready.
Ten reports exhaust a ten-credit package. Another report is denied without work
or another charge. Retry original credit purchase resumes the retained intent;
a pending purchase blocks creation of another package until reconciled.

Prepaid is supported only for the issuer's own services. Maya and Sasha do not
receive a third-party wallet or redeem credits into seller proceeds. The package
owns the balances, reservations, payment evidence and credit accounting.
For production, send the original purchase result's `clientSecret` only to the
authenticated purchaser's Stripe payment UI. Replace the synthetic test-card
confirmation with that UI, then observe the original purchase until it is ready.

The product example deliberately supports USD, whole units, whole minor-unit
rates and bounded native payment amounts. The package supports broader exact
quantity and rate contracts; see [configuration](usage-configuration.md).

## Payment, allowance and settlement boundaries

The example rechecks the original native subscription before new work. For paid
monthly products it also verifies the original initial invoice and current
period invoice, exact product/base price/quantity, payer mapping, complete native
line and funding pages, captured PaymentIntent, and refund/dispute state.
Unknown, partial, unpaid or changed evidence blocks work. The atomic work mutation
must match the exact binding that passed the fresh check; a racing refresh cannot
move it into another unverified billing period.

Included allowance is scoped to the original subscription item and native period.
A renewal starts a new allowance only when that observed period is active on the
server. Old period usage remains unchanged. Stripe's meter summary endpoint requires
minute-aligned boundaries. For ordinary Checkout periods with partial-minute
boundaries, an exact aggregate read is explicitly unsupported. Delivered usage
is retained and the native invoice preview remains available; the example does
not round a billing period and claim an exact reconciliation. Credit grants also keep their original
price and ownership terms.

**Automatic seller settlement for mixed fixed-fee and usage invoices is not
supported by the current verifier.** Customer billing can work while seller
transfers remain held. The example does not bypass the verifier, report a paid
invoice as settled earnings, or allocate mixed cash using a browser estimate.
Existing single-source settlement protocols remain in the separate diagnostics.

## Package APIs and UI implementations

The host adapter is in `example/convex/meteredProducts`. Its tables store product
terms, enrollment provenance, purchase identities and completed application work.
They are not another usage ledger or credit wallet.

The catalog path calls `ensureUsageMeter`, `ensureUsagePrice` and `ensurePrice`.
For coaching, the enrollment path calls `usage.ensureCheckout` with the metered price and
`fixedPriceIds: [originalMonthlyBasePriceId]`. Never infer these IDs from the
browser or purchase a base price alone through regular checkout. The example
storefront routes metered products to their enrollment workflow. Prepaid report
services use `usage.ensureSubscription` with `send_invoice`, the collection policy
required by the package credit-purchase protocol.

`product-usage-configuration.tsx` uses `useUsageConfiguration` for the headless
form and `UsageConfiguration` for the component form. Both receive identical
host callbacks. `metered-product-usage.tsx` uses `useUsageBilling` and
`useUsageHistory` for custom rendering, and `UsageBilling` and `UsageHistory`
for the component view. Switching views does not create another subscription,
usage event or credit purchase.

Demo personas are not production authentication. Each server operation checks
its test key and persona/resource binding; an authenticated identity, when
present, must match the persona. Replace this with real authentication and
server-owned authorization before adapting the example. See
[security](usage-security.md), [subscriptions](usage-subscriptions.md),
[ledger](usage-ledger.md), [delivery](usage-delivery.md) and
[credits](usage-credits.md).

## Developer protocol diagnostics

Admin → Metered billing → Developer protocol diagnostics retains the original
isolated, three-model exercises for corrections, delivery recovery, test-clock
renewals, original cash/fee/transfer evidence and scoped cleanup. Follow the
[protocol diagnostics guide](usage-protocol-diagnostics.md). These diagnostic
runs retain their original resource IDs and historical evidence; they do not
change the product membership's customer or shared catalog resources.
