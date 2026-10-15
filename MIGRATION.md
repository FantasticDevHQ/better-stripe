# Migrating to 0.5.0 and Stripe Endive

## Combined payout eligibility preview

`stripe.payoutPolicy.preview` is an additive server API. Regenerate the component
bindings when upgrading. No table migration or provider schedule change is
required to read it. Keep existing release and automatic worker calls; the
preview does not replace either. Authenticate the recipient and resolve
liabilities on the server before calling it. See the
[preview contract and display guidance](docs/settlement.md#payout-eligibility-preview)
for detailed versus unavailable assessments, shared deductions, and the
difference between an application attempt and a bank arrival.

Detailed previews now include optional `accounting` totals and per-source
reserved/paid amounts. Regenerate component bindings and deploy the component
before using them. `PayoutProgress` renders these fields when supplied; older
results continue to render without them. Custom renderers must treat missing
fields as unavailable rather than zero. No table migration is required.

## Package and runtime

Payout worker discovery, expiry, local snapshot collection, pending affiliate
payouts and seller cost history now use component-compatible pagination. The
page result shape is unchanged. Clear cached pagination cursors and reload from
null after upgrading these readers. Component bindings must be regenerated and
the component deployed; no table migration or schedule change is required.
See [collection restart safeguards](docs/settlement.md#resumable-local-collections).

Install `@fantastic.dev/better-stripe@0.5.0`. The old
`@getdojo/better-stripe` name is deprecated. Replace imports and the component
config import with the new name, retaining your existing component instance
name (for example `betterStripe`) so its stored data remains attached. Run
`npx convex dev` against your development deployment to regenerate bindings.
Node.js 20 or newer is required by stripe-node 23.

The package depends on `stripe ~23.0.0`, whose supported API is exactly
`2026-09-30.endive`. The typed `STRIPE_API_VERSION` constant in
`src/client/constants.ts` pins app clients, component actions, and webhook
resource refreshes. This SDK and pin were already present in the 0.4.0 checkout;
0.5.0 adds fulfillment retries and completes the V2/React compatibility fixes.
Leave `stripeApiVersion` unset to use this pin. The legacy string override is
retained for compatibility, but overriding it does not change the SDK's types
or convert webhook payloads and can make requests inconsistent with them.

## Remove Dojo's consumer patch

Remove the `@getdojo/better-stripe@0.2.0` entry from pnpm's
`patchedDependencies` and delete `patches/@getdojo__better-stripe@0.2.0.patch`.
Update the dependency/imports and regenerate the lockfile. The upstream
`RegisterRoutesConfig.retryOnHookError` has the same signature and V1 semantics
as that patch. Dojo can keep its existing selector:

```ts
retryOnHookError: (event) => {
  if (event.type !== "checkout.session.completed" || !("data" in event)) {
    return false;
  }
  const metadata = (event.data.object as {
    metadata?: Record<string, string>;
  }).metadata;
  return (
    (metadata?.purchaseType ?? metadata?.purchase_type) === "communityMembership" &&
    metadata?.dojoMembershipFulfillment === "1"
  );
},
```

For selected **verified V1 events**, component processing commits first;
`onEvent` and the matching `events[type]` hook then run before the event is marked
processed. A hook failure records `failed` and returns HTTP 500. A concurrent
delivery returns 503; ledger reservation/completion failures return 500. Failed
events can be retried immediately; an abandoned processing reservation can be
retried after ten minutes. Once processed, redelivery deduplicates without
re-running the hooks. Selector exceptions also return 500.

Hooks and any sync triggers must be idempotent using `event.id` or a durable
business key: processing can run again after a hook failure, and hook success
followed by a failed completion write can rerun a successful hook. This is
at-least-once fulfillment. Unselected events, V2 hooks, and scheduled
`asyncWebhook` hooks keep their existing best-effort acknowledgment behavior.
Put required fulfillment in `onEvent`/`events`, not in a scheduled hook.

### Existing breaking change when coming from 0.2.0

The 0.3.0/0.4.0 webhook wiring change remains required: `triggersApi()` was
replaced by `webhookHandlers()`. The constructor's `triggers` and `hooks` stay
the same. Export the two wrappers:

```ts
export const { syncWebhook, asyncWebhook } = stripe.webhookHandlers();
```

In `registerRoutes`, replace `triggers: internal.stripe` with
`webhooks: internal.stripe`. Regenerate Convex bindings before using the pair.

## Stripe request and response changes

- **V2 account links:** `use_case.account_onboarding.configurations` and
  `use_case.account_update.configurations` are removed. The public
  `createV2AccountLink({ configurations })` option is retained, deprecated, and
  ignored. Stripe collects requirements for the account without it.
- **Billing-cycle anchors:** Endive changes Subscription update/resume and
  invoice preview `subscription_details.billing_cycle_anchor` to an object,
  for example `{ type: "now" }` or `{ type: "unchanged" }`. These wrappers
  currently send no billing-cycle anchor; no scalar anchor request needed
  rewriting. Consumer raw SDK calls to those endpoints must migrate. Creation
  and Checkout `subscription_data.billing_cycle_anchor` still accept a Unix
  timestamp; do not convert those fields to the update format.
- **Payment methods:** Checkout Session creation and PaymentIntent
  create/update/confirm and SetupIntent create/update no longer accept
  `payment_method_types`. Use `allowed_payment_method_types` for a restriction,
  or omit it for dynamic methods; retain `automatic_payment_methods` only where
  supported. The package's Checkout requests omit the removed parameter.
  Update consumer `sessionOverrides` and raw Stripe calls; SDK 23 types catch
  old parameters. Subscription/invoice `payment_settings.payment_method_types`
  and PaymentMethod list `type` are separate, still-supported parameters.
- **Account status:** an applied V2 configuration with a `rejected` or
  `restricted` capability now maps to public `restricted`; a `pending`
  capability maps to `in_progress`, including nested `stripe_balance` groups.
  Unsupported optional payment methods do not block onboarding. Existing public
  status strings remain unchanged.
- **V2 notifications:** signature verification uses
  `parseEventNotificationAsync`. Account refreshes propagate the notification's
  `context` via `stripeContext`. `related_object.id` is now optional because
  singleton pointers can omit it; account pointers can resolve from their URL.
  Consumers reading the public thin-event type must guard an absent id. Other
  singleton resource events remain outside the account-sync handler's scope.
- **React embedded Checkout:** React Stripe.js 7 calls the current Stripe.js 10
  `createEmbeddedCheckoutPage` API. `EmbeddedCheckout` keeps its public props and
  now remounts the provider when the key or client secret changes, destroying
  the previous session rather than keeping an immutable provider on it.

## Upgrade webhook payload versions separately

Installing this package pins outgoing API requests. It does **not** change your
Stripe account's default API version or the version of an existing event
destination. In particular, a V1 snapshot event keeps the version configured on
its destination, regardless of `stripeApiVersion`.

1. Deploy and test the consumer upgrade in a Stripe sandbox first. Preserve
   your current endpoint URL, selected events, and signing secrets.
2. In Stripe Workbench, review the destination's current version and the
   [Endive changelog](https://docs.stripe.com/changelog/2026-09-30.endive).
   Review every intervening breaking release if coming from Dahlia.
3. Use Stripe's destination-version upgrade/testing procedure to test Endive
   V1 snapshot payloads and V2 thin notifications separately. V2 uses
   `webhookSecretV2` if set; otherwise it uses `webhookSecret`.
4. Verify subscription fulfillment, cancellation, required-hook failure/retry,
   and deduplication in sandbox before explicitly upgrading production
   destinations. Keep the Stripe rollback window and its documented limits in
   mind. Do not change the account default version as part of a package upgrade.

The official [stripe-node 23.0.0 changelog](https://github.com/stripe/stripe-node/blob/v23.0.0/CHANGELOG.md#2300---2026-09-30)
and installed SDK 23 types were reviewed for the breaking request/response
changes. Further consumer guidance: [Stripe API changelog](https://docs.stripe.com/changelog),
[API versioning](https://docs.stripe.com/upgrades), and
[event destinations](https://docs.stripe.com/event-destinations).
The docs.stripe.com changelog page returned HTTP 403 in this execution
environment.

## Upcoming settlement API extraction

Deploy the regenerated component bindings with the package upgrade. Existing
transfers remain in the same ledger; new immutable allocation and commission
claims use additional component tables. The example's old subscription claims
must be migrated before replaying history; see [settlement migration](docs/settlement.md).

React `Checkout` now preserves `requestId` on retry instead of creating a new
one. Forward it to server request options. Use a different `orderKey` for a new
purchase and persist `requestId` for recovery across reloads. Existing callback
implementations remain compatible when they ignore the optional identity.

## Customer-only Accounts v2 preview configuration

The default API version remains `2026-09-30.endive`. Non-Connect merchants can
explicitly select `STRIPE_CUSTOMER_PREVIEW_API_VERSION` after the sandbox owner
enables Stripe's preview. Constructor options are validated; instance webhook
registration inherits the selected key/version and rejects conflicts. Existing
standalone route registration remains supported.

Destination creation now uses the client's selected snapshot version. Existing
destinations whose immutable version or preview event scope differs require a
replacement path and signing-secret cutover; they are not silently reused.
See [preview setup and migration](docs/accounts-v2-preview.md). No Connect
onboarding or payout-retention policy changes are part of this opt-in.

## Portal cancellation synchronization

Stripe Billing Portal can schedule period-end cancellation using `cancel_at`
while `cancel_at_period_end` remains false. BetterStripe normalizes the stored
`cancelAtPeriodEnd` to true when that timestamp matches the current billing
period end, so subscription components offer reactivation after portal changes.
Webhook processing and explicit subscription synchronization use the same rule.
A cancellation timestamp at another date is not classified as period-end cancellation.

## Component history and currency summaries

See the [read contract guide](docs/read-contracts.md) for reactive product, price and payout
cursors, exact currency summaries, legacy backfill, payout failure details, and
published-version adoption requirements.

## Versioned payout recovery quotes

Hosts with component recovery balance records must now pass `stripe.costRecovery.payoutQuote(ctx, authorizedScope)` into payout preview/release/worker options. Pass the returned `independentLiabilities` and `liabilityRevision` together for the same authorized account/currency/scope. Calls without a required version fail safely; accounts without recovery records retain the unversioned path. The example adapters are updated. Additional host-owned liabilities still require host authorization and consistency guards; the component version does not cover external databases.

Do not backfill old attempted claims with guessed quotes. Reconcile their existing request, or replay an unattempted operation to cancel its exact reservations, then use a new operation and fresh quote. Obsolete read-only collection fingerprints can be discarded and recollected; financially bound or unresolved claim state must remain intact.
