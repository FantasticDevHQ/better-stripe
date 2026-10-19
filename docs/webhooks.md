# Webhooks and triggers

## Webhook API

### registerRoutes

Register the webhook endpoint on your Convex HTTP router:

```typescript
import { stripe } from "./stripe"; // Your configured BetterStripe instance.

stripe.registerRoutes(http, {
  webhookPath: "/stripe/webhook", // Default path
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  webhookSecretV2: process.env.STRIPE_WEBHOOK_SECRET_V2, // For V2 thin events
  webhooks: internal.stripe, // The { syncWebhook, asyncWebhook } pair from webhookHandlers()
  events: { ... }, // Optional per-event handlers (advanced)
  onEvent: (ctx, event) => { ... }, // Optional catch-all handler (advanced)
});
```

### Webhook Setup

Stripe event destinations come in two flavors that cannot be mixed:

- **Snapshot** (`event_payload: 'snapshot'`) — V1 events include the full object in the payload. Used for payments, subscriptions, invoices, products, and payouts.
- **Thin** (`event_payload: 'thin'`) — V2 events include only the event type and object reference. The handler fetches the full object from the Stripe API. Used for Connect account lifecycle events.

You need **two** event destinations pointing to the same webhook URL, each with its own signing secret.

#### Programmatic setup

Use `setupEventDestination()` to create or update destinations:

```typescript
// Create V1 snapshot destination
const v1 = await stripe.setupEventDestination(ctx, {
  url: webhookUrl,
  eventPayload: "snapshot",
});

// Create V2 thin destination
const v2 = await stripe.setupEventDestination(ctx, {
  url: webhookUrl,
  eventPayload: "thin",
});
```

The method finds an existing destination matching URL and payload type and
updates its events, or creates a new one. It rejects incompatible existing
snapshot versions and customer-preview event scopes instead of silently
migrating them. Preserve the original destination and signing secret until its
explicit replacement is configured. See [preview webhook migration](accounts-v2-preview.md).

The instance method `stripe.registerRoutes` inherits the configured SDK key and
API version. Standalone `registerRoutes(http, components.betterStripe, config)`
remains available; supply the same `stripeApiVersion` explicitly for a preview client.

#### Admin UI setup

The example app includes an `/admin/setup` page that handles webhook creation, env var verification, demo data seeding, and Stripe data syncing — all from the browser.

#### Event constants

```typescript
import {
  BETTER_STRIPE_WEBHOOK_EVENTS, // Default V1 snapshot event names
  BETTER_STRIPE_V2_WEBHOOK_EVENTS, // Default Connect V2 thin event names
  ALL_BETTER_STRIPE_EVENTS, // Combined defaults, not every optional event handler
} from "@fantastic.dev/better-stripe";
```

Customer-only preview clients select `BETTER_STRIPE_CUSTOMER_ACCOUNT_EVENTS`
for their default thin destination instead of the Connect list. Metered billing
also handles `v1.billing.meter.error_report_triggered` and
`v1.billing.meter.no_meter_found` as signed thin events. Those names are not in
`ALL_BETTER_STRIPE_EVENTS`; configure them explicitly as described in
[asynchronous metering errors](usage-delivery.md#receive-asynchronous-native-validation-errors).

### Event Processing

Records synced from Stripe objects without `userId` metadata are stored unattributed (`userId: ""`) and are not returned by user-scoped queries.

The webhook handler processes events through these steps:

1. Verify Stripe signature
2. Record the event in the `webhookEvents` ledger by `stripeEventId`. If the event was already seen and is `processed`, `ignored`, or still within its processing lease, return 200 immediately. A stale processing lease can be retried. If the previous delivery `failed` (its writes rolled back), the ledger row is reset and the event is reprocessed on Stripe's retry.
3. Upsert the component-owned domain table. When `webhooks` is configured, the upsert runs through `syncWebhook` — an internal mutation that performs the upsert **and** the sync trigger in the same transaction.
4. On failure, mark the ledger row `failed` and return 500 so Stripe retries; otherwise mark it `processed`
5. Schedule the matching `after*` async hook via `ctx.scheduler` (separate action)

### Required V1 hook delivery

By default, `onEvent` and `events[type]` callbacks are best-effort.
For selected verified V1 events, `retryOnHookError(event)` can require them to
succeed before acknowledgment:

```ts
retryOnHookError: (event) => event.type === "checkout.session.completed",
```

For that selection, component processing commits first; the callbacks run before
the event is marked processed. Callback failures return 500 and permit redelivery.
A concurrent in-flight delivery returns 503, and a failed reservation/completion
also returns 500. An abandoned processing lease becomes retryable after ten
minutes. Sync triggers and callbacks must remain idempotent by `event.id` or a
durable business key because they can run again after partial success.

Unselected callbacks, V2 hooks and scheduled `asyncWebhook` hooks keep best-effort
acknowledgment behavior. Required fulfillment belongs in the selected V1
`onEvent`/`events` path, not a scheduled hook. Refund synchronization independently
requires ledger success even without an application retry selector. See
[the migration contract](../MIGRATION.md#remove-dojos-consumer-patch).

### Ledger-Based Deduplication

The component maintains a `webhookEvents` table that tracks every event by its Stripe event ID. This provides:

- **Replay protection** -- duplicate events are detected and skipped
- **Retry recovery** -- events whose processing failed (and rolled back) are reprocessed when Stripe retries, instead of deduplicating forever
- **Crash recovery** -- if a delivery dies mid-processing (timeout, restart), the `processing` row goes stale after 10 minutes and the event is reprocessed on Stripe's next retry instead of deduplicating forever
- **Failure tracking** -- failed events are marked with status and error message
- **Observability** -- all events (including unsupported types) are logged with `ignored` status

### Supported Events

**Accounts V2 (thin events -- component fetches latest state, requires V2 event destination):**

- `v2.core.account.created`, `.updated`
- `v2.core.account[identity].updated`
- `v2.core.account[requirements].updated`
- `v2.core.account[configuration.merchant].updated`, `.capability_status_updated`
- `v2.core.account[configuration.customer].updated`
- `v2.core.account[configuration.recipient].updated`
- `v2.core.account[defaults].updated`
- `v2.core.account_person.created`, `.updated`
- `v2.core.account_link.returned`

**Billing (snapshot events -- payload contains full state):**

- `checkout.session.completed`
- `customer.subscription.created`, `.updated`, `.deleted`, `.trial_will_end`
- `invoice.created`, `.finalized`, `.paid`, `.payment_failed`
- `payment_intent.succeeded`, `.payment_failed`, `.canceled`
- `payout.created`, `.updated`, `.paid`, `.failed`, `.canceled`

- `refund.created`, `.updated`, `.failed`
- `application_fee.refunded` -- keeps `feeCollectedAmount`/`feeRefundedAmount` accurate on the linked payment
- `charge.dispute.created`, `.updated`, `.closed`, `.funds_withdrawn`, `.funds_reinstated`
- `product.created`, `.updated`
- `price.created`, `.updated`

Note: Subscription and invoice events use v1 Billing API event names even when the billing entity is a V2 account referenced via `customer_account`.

Dedicated payout cancellations use the same signed V1 endpoint, payout record
and connected-account association as other payout events. Generic `onEvent`
and `events["payout.canceled"]` callbacks run after reconciliation. Cancellation
does not invoke the paid/completed convenience hook. Normal verified replay is
deduplicated by the existing event ledger.

When upgrading from 0.11.0 or earlier, add `payout.canceled` to the existing V1
endpoint's selected events. New endpoints created with the corrected package's
defaults include it. Updating the library alone does not edit an existing provider
endpoint or recover already missed events. Consumers must adopt a published
version containing this correction; a merged source fix is not a package release.

## Trigger API

The trigger system follows the BetterAuth pattern: define callbacks at client init time, export the `syncWebhook`/`asyncWebhook` pair via `webhookHandlers()`, and pass their function references to `registerRoutes` via `webhooks`.

### SyncTriggers

Sync triggers run in the same transaction as the component's database write. They must be DB-only and idempotent. Throwing from a sync trigger rolls back the entire transaction (including the component upsert), causing Stripe to retry the webhook.

```typescript
interface SyncTriggers {
  account?: {
    onCreate?: (ctx, doc) => Promise<void>;
    onUpdate?: (ctx, newDoc, oldDoc) => Promise<void>;
  };
  subscription?: {
    onCreate?: (ctx, doc) => Promise<void>;
    onUpdate?: (ctx, newDoc, oldDoc) => Promise<void>;
    onDelete?: (
      ctx,
      doc,
      oldDoc?: StripeComponentSubscription | null,
    ) => Promise<void>;
  };
  checkoutSession?: {
    onCompleted?: (ctx, doc) => Promise<void>;
  };
  product?: {
    onCreate?: (ctx, doc) => Promise<void>;
    onUpdate?: (ctx, newDoc, oldDoc) => Promise<void>;
  };
  price?: {
    onCreate?: (ctx, doc) => Promise<void>;
    onUpdate?: (ctx, newDoc, oldDoc) => Promise<void>;
  };
  invoice?: {
    onCreate?: (ctx, doc) => Promise<void>;
    onUpdate?: (ctx, newDoc, oldDoc) => Promise<void>;
  };
  payment?: {
    onCreate?: (ctx, doc) => Promise<void>;
  };
  payout?: {
    onCreate?: (ctx, doc) => Promise<void>;
    onUpdate?: (ctx, newDoc, oldDoc) => Promise<void>;
  };
  refund?: {
    onCreate?: (ctx, doc) => Promise<void>;
    onUpdate?: (ctx, newDoc, oldDoc) => Promise<void>;
  };
  dispute?: {
    onCreate?: (ctx, doc) => Promise<void>;
    onUpdate?: (ctx, newDoc, oldDoc) => Promise<void>;
  };
}
```

`subscription.onDelete` receives the resulting canceled mirror as argument two
and its exact unique pre-upsert document as argument three, in the same
transaction. Confirmed absence is `null`. The third argument is optional to
preserve two-argument consumers and legacy callers; `undefined` does not certify
absence. Duplicate cached identities reject before upsert, and a missing or
ambiguous resulting row also rejects. Callback failures roll back both mirror
and host writes. Metadata can locate host scopes to invalidate; it never proves
original purchase provenance. With no delete callback, mirror-only behavior is
unchanged.

### AsyncHooks

Async hooks run after the component's database write commits, in a separate scheduled action. Use these for external API calls (email, Slack, analytics). Failures do not roll back the component write.

```typescript
interface AsyncHooks {
  onAccountUpdated?: (ctx, account) => Promise<void>;
  onCheckoutCompleted?: (ctx, session) => Promise<void>;
  onSubscriptionUpdated?: (ctx, subscription) => Promise<void>;
  onSubscriptionCanceled?: (ctx, subscription) => Promise<void>;
  onTrialEnding?: (ctx, subscription) => Promise<void>;
  onInvoicePaid?: (ctx, invoice) => Promise<void>;
  onInvoicePaymentFailed?: (ctx, invoice) => Promise<void>;
  onPaymentSucceeded?: (ctx, payment) => Promise<void>;
  onPaymentFailed?: (ctx, payment) => Promise<void>;
  onPayoutCompleted?: (ctx, payout) => Promise<void>;
  onRefundCreated?: (ctx, refund) => Promise<void>;
  onDisputeCreated?: (ctx, dispute) => Promise<void>;
  onDisputeClosed?: (ctx, dispute) => Promise<void>;
}
```

### webhookHandlers()

Returns the `{ syncWebhook, asyncWebhook }` pair that bridges your app callbacks into the webhook processing pipeline. Export them from a Convex module (e.g. `convex/stripe.ts`) so they get function references the webhook handler can call:

```typescript
export const { syncWebhook, asyncWebhook } = stripe.webhookHandlers();
```

Then pass the module to `registerRoutes` as `webhooks: internal.stripe`.

**How `syncWebhook` works.** It is a single internal mutation that routes by a `dispatcher` discriminator to perform the component table upsert **and** your configured sync trigger inside one transaction. It reads the existing doc (to decide `onCreate` vs `onUpdate` and supply `oldDoc`), runs the upsert, re-reads the doc, and invokes your trigger. If the trigger throws, the whole mutation — including the component write — rolls back, the webhook handler marks the ledger row `failed`, and returns 500 so Stripe retries. On retry, failed ledger rows are reset and the event is reprocessed.

**How `asyncWebhook` works.** It is a single internal action that routes by a `hook` discriminator. After the `syncWebhook` transaction commits and the ledger marks the event `processed`, the webhook handler schedules `asyncWebhook` via `ctx.scheduler` with the committed doc. Hook failures never roll back the component write.

Exactly one hook (at most) is scheduled per event:

| Stripe event                                      | Scheduled hook              |
| ------------------------------------------------- | --------------------------- |
| `v2.core.account*` (all account lifecycle events) | `afterAccountUpdated`       |
| `checkout.session.completed`                      | `afterCheckoutCompleted`    |
| `customer.subscription.created` / `.updated`      | `afterSubscriptionUpdated`  |
| `customer.subscription.deleted`                   | `afterSubscriptionCanceled` |
| `customer.subscription.trial_will_end`            | `afterTrialEnding`          |
| `invoice.paid`                                    | `afterInvoicePaid`          |
| `invoice.payment_failed`                          | `afterInvoicePaymentFailed` |
| `payment_intent.succeeded`                        | `afterPaymentSucceeded`     |
| `payment_intent.payment_failed`                   | `afterPaymentFailed`        |
| `payout.paid`                                     | `afterPayoutCompleted`      |
| `refund.created`                                  | `afterRefundCreated`        |
| `charge.dispute.created`                          | `afterDisputeCreated`       |
| `charge.dispute.closed`                           | `afterDisputeClosed`        |

All other processed events (e.g. `payment_intent.canceled`, `payout.failed`, `invoice.created`, `refund.updated`, `charge.dispute.funds_withdrawn`) update the component tables but schedule no hook.

> **Note:** async hooks should be idempotent. Duplicate delivery is possible in rare ledger-failure cases (e.g. the event is processed and the hook scheduled, but the ledger update fails and Stripe redelivers).

The raw callbacks you pass to `triggers` and `hooks` on the `BetterStripe` constructor are the source of truth for app behavior. The exported `syncWebhook`/`asyncWebhook` pair is the bridge that makes them callable from the Convex runtime — events whose triggers you did not configure simply run the upsert (no sync trigger) and schedule no hook.

### Dunning & smart retries

Failed recurring payments are recovered by **Stripe Smart Retries**, not by any retry loop in this library. The component never re-attempts a charge itself — it tracks the delinquency and fires hooks so your app can notify the customer. Retry _timing and count_ are owned entirely by Stripe.

**Required Dashboard settings** (Stripe controls the schedule; enable these once):

- **Subscriptions:** Dashboard → **Billing → Revenue recovery → Retries** — turn on **Smart Retries** (Stripe's recommended, ML-timed schedule). Also set what happens when retries are exhausted (leave `past_due`, mark `unpaid`, or cancel).
- **One-time invoices:** Dashboard → **Settings → Billing → Invoices** — configure retry behavior for invoices not tied to a subscription.
- Ensure the `invoice.payment_failed` and `customer.subscription.updated` events are delivered to your webhook endpoint.

**What the component surfaces:**

- The subscription row tracks Stripe's delinquency states — `past_due` (first failed charge) and `unpaid` (retries exhausted) — arriving via `customer.subscription.updated`, which fires **`onSubscriptionUpdated`**.
- Each `invoice.payment_failed` fires **`onInvoicePaymentFailed`** with the committed invoice. Under Smart Retries the invoice carries `nextPaymentAttempt` (ISO time of Stripe's next retry) and `attemptCount`, so a dunning email can tell the buyer exactly when Stripe will try again. Both clear once the invoice is paid or retries stop.

`onInvoicePaymentFailed` is the **invoice-level** (subscription-cycle) failure — distinct from `onPaymentFailed`, which fires on a one-time **PaymentIntent** failure (`payment_intent.payment_failed`) and receives a payment, not an invoice.

> **Limitation:** `nextPaymentAttempt` is captured from the `invoice.payment_failed` payload, which is correct for Smart Retries. If you instead use a **custom retry _automation_**, Stripe sets `next_payment_attempt` on `invoice.updated` (not `invoice.payment_failed`); the component does not currently process `invoice.updated`, so the retry timestamp may lag until the next handled invoice event.
