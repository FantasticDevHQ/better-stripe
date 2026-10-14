# Customer-only Accounts v2 preview

Connect platforms keep the default `2026-09-30.endive` API version. Non-Connect
merchants can explicitly opt into `2026-09-30.preview` for customer-configured
Accounts. The package does not enable Connect or onboard a merchant/recipient
when creating a buyer with `ensureCustomerAccount`.

## Enable the sandbox feature first

In the intended sandbox, the account owner must enable **Reusable payment
methods for Global Payouts** under **Account previews and features**. If the toggle
is unavailable, request access using Stripe's form. This also enables Stripe's
reusable payout credentials preview; it is not a Connect onboarding flow.
Changing an API version cannot enable the feature on the Stripe account.

Enabling the preview synchronizes existing Customers with customer-configured
Accounts and changes how Stripe-hosted integrations create customers. Review
Stripe's limitations and migration behavior before changing any live account.
See [Stripe's customer Account guide](https://docs.stripe.com/accounts-v2/use-accounts-as-customers).

## Configure one client and its webhook route

```ts
// convex/stripe.ts
import {
  BetterStripe,
  STRIPE_CUSTOMER_PREVIEW_API_VERSION,
} from "@fantastic.dev/better-stripe";
import { components } from "./_generated/api";

export const stripe = new BetterStripe(components.betterStripe, {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  stripeApiVersion: STRIPE_CUSTOMER_PREVIEW_API_VERSION,
});
```

```ts
// convex/http.ts
import { httpRouter } from "convex/server";
import { stripe } from "./stripe";

const http = httpRouter();
stripe.registerRoutes(http, {
  webhookPath: "/stripe/webhook",
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  webhookSecretV2: process.env.STRIPE_WEBHOOK_SECRET_V2,
  // Preserve your existing `webhooks` handler references and retry policy here.
});
export default http;
```

The instance route inherits its client's key and version. Conflicting explicit
values fail at registration. The standalone `registerRoutes` function remains
available; when using it, pass `stripeApiVersion: stripe.stripeApiVersion` and the
same secret key explicitly. The client accepts only the supported GA and customer
preview versions; unsupported values fail with `INVALID_CONFIGURATION`.

All client operations use the selected version: account creation/configuration,
Checkout, subscriptions, portal sessions, refunds, authoritative reads, and the
provider calls made while handling webhooks. Component database writes remain
provider-version independent. SDK caches separate clients by key and version.

## Create a buyer and Checkout Session

Authenticate the caller and validate ownership/prices on the server. The client
is not an authorization boundary. Persist logical request identities in your host
app so retries keep the same provider keys and new purchases use distinct keys.

```ts
const buyer = await stripe.ensureCustomerAccount(ctx, {
  userId: identity.subject,
  email: verifiedEmail,
  idempotencyKey: accountProvisioningKey,
});
const checkout = await stripe.createCheckoutSession(ctx, {
  userId: identity.subject,
  accountId: buyer.stripeAccountId,
  stripePriceId: authorizedPriceId,
  mode: "subscription",
  uiMode: "redirect",
  returnUrl: "https://example.com/receipt?session_id={CHECKOUT_SESSION_ID}",
  idempotencyKey: orderKey,
});
```

The buyer is an `acct_` object with the customer configuration. Checkout uses
`customer_account`, not a connected-account destination. No seller, recipient,
transfer, or application fee is added by this configuration.

After verifying buyer/order ownership, use `getCheckoutSessionFromStripe` to
check current payment status. Completion alone does not prove payment: fulfill
only when your payment policy accepts the authoritative status, and deduplicate
fulfillment by a durable order key. Subscription and coupon reads use the same
configured version. Cancellation/reactivation and refunds keep their existing
public API signatures and caller idempotency behavior.

## Match webhook payload versions and scope

Snapshot destinations created through this client pin `snapshot_api_version` to
the selected version. V1 webhook endpoints pin their `api_version`. Thin events
are unversioned; their related customer Account is fetched with the selected
request version and only customer/identity includes in customer-preview mode.

The preview's default thin subscription covers Account creation, customer
configuration changes, and identity changes, using Stripe's `@self` and
`@accounts` scopes. Subscription and invoice changes continue to use V1 snapshot
events. No merchant or recipient capability events are subscribed by default in
customer-preview mode. The GA defaults retain their existing event selection.

Stripe cannot update a destination's snapshot version or event scopes in place.
`setupEventDestination` refuses an incompatible existing destination rather than
silently reusing it. Create a replacement at a new webhook path, register the
matching route and signing secret, verify deliveries, then retire the old
endpoint. A low-level `createWebhookEndpoint` call retains its existing same-URL
secret-rotation behavior; do not use it as an implicit migration plan.

See [event destination creation](https://docs.stripe.com/api/v2/core/event-destinations/create)
and [update restrictions](https://docs.stripe.com/api/v2/core/event-destinations/update).

## Verification boundary

Package tests exercise serialized SDK request headers, customer-only account
configuration, idempotency keys, Checkout buyer binding, authoritative reads,
subscription cancellation/reactivation, portal and refund calls, webhook route
configuration, thin-event synchronization, and snapshot version/scope checks.
The GA version has regression coverage alongside the preview version.

A real non-Connect sandbox test additionally requires the owner-enabled preview
and sandbox credentials. A Connect sandbox, mocked transport, or successful
TypeScript compilation does not prove that separate eligibility requirement.
Do not report checkout, receipt, renewal, portal or refund acceptance as verified
for a non-Connect merchant until those flows run in its enabled sandbox.
