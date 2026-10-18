# Deliver accepted usage to native Stripe

Start with the [catalog](usage-catalog.md) and [atomic ledger](usage-ledger.md).
This layer sends the same immutable usage records for all three billing models.
It does not purchase prepaid credits, collect payment, finalize invoices or settle
seller proceeds. Native Stripe Billing Meters need no Metronome token.

## Register a host internal provider action

The component owns the outbox, Workflow journal, rate limits and receipts. The
host owns credentials and authorization. Register this action in your Convex app:

```ts
import { internalAction } from "./_generated/server";
import {
  usageDeliveryArgs,
  usageDeliveryResult,
} from "@fantastic.dev/better-stripe/usage";
import { stripe } from "./stripe"; // Your configured BetterStripe instance.

export const sendUsage = internalAction({
  args: usageDeliveryArgs,
  returns: usageDeliveryResult,
  handler: (ctx, request) =>
    stripe.usage.deliver(ctx, request, {
      stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    }),
});
```

Then record and dispatch from an authorized host mutation. Authenticate the actor,
authorize the exact realm/payer/meter, apply your billable-activity policy and
resolve the subscription binding from verified server state before this code:

```ts
const receipt = await stripe.usage.record(ctx, {
  event: serverEvent,
  subscription: verifiedSubscription,
});
await stripe.usage.startDelivery(ctx, {
  scope: serverEvent.scope,
  eventId: receipt.eventId,
  provider: internal.billing.sendUsage,
});
return receipt;
```

Both calls participate in the host mutation transaction. A failed dispatch rolls
back acceptance too. Alternatively, accept without dispatch and start delivery
later from an internal worker. Never accept a provider function reference,
credential, price or unverified scope from a browser. Reauthorize every status,
hold and resume request. The internal provider action must use the package's
`deliver` helper and must not implement its own retry loop.

`startDeliveryBatch` accepts one scope, the same internal provider reference and
1–10 event IDs. Each event has its own durable progress. If a host action fails
partway through dispatching a batch, replay its original IDs; completed dispatches
are idempotent. Delivery is individually submitted, with no unbounded native
batch or account-wide scan.

## Execution and retries

The existing nested Workflow runtime runs at most two steps concurrently and
never retries provider actions automatically. Delivery additionally reserves a
single slot per native customer/meter across Accounts v2 payer aliases, and a
conservative account/mode rate of one send per second. Claims use Convex
transactions. A send lease lasts 15 minutes, beyond the host action execution
limit. The native helper rechecks its attempt and lease immediately before the
write. Native requests use a 15-second timeout and zero SDK network retries.

The immutable event pins its Stripe API version and routing/pricing snapshot.
Delivery definition version 1 and the internal provider handle are retained.
The outbox's `bs_usage_…` identifier is also the native idempotency key. Neither
identity changes on resume. Credentials are supplied at execution time and never
stored in outbox rows or Workflow arguments/results.

Known HTTP 429 responses back off exponentially, with at most three sends per
Workflow run and a 60-second delay ceiling. Other queued events retain their
progress. Missing credentials and preflight failures stop as `provider_unavailable`
until an administrator fixes the configuration and resumes. Explicit validation
rejections stop as `rejected`. Ambiguous responses, duplicate-identifier errors,
network loss and provider 5xx responses become `unknown` and retain the possible
effect. Raw SDK errors and response payloads do not enter the journal.

A failed receipt mutation can resume from that failed step using the already
journaled provider result. Do not restart from step zero, delete the outbox or
change the source identifier. A worker crash before the provider result is
journaled becomes unknown when its send lease expires.

New delivery must still fall within Stripe's 35-day past/5-minute future event
window. Automatic sends also stop 23 hours after the first send attempt. Stripe
retains deduplication for at least 24 hours, not forever. A historical acceptance
receipt remains valid after these windows expire, but does not authorize replay.
The adapter never changes the original occurrence time to make an event eligible.
For a sandbox subscription attached to a test clock, delivery additionally reads
the native clock and checks its 35-day past/5-minute future window. An advancing
or unavailable clock holds delivery. A timestamp outside its native window is
rejected before sending. Production source timestamps remain unchanged.

## Status and operational controls

Use `getDelivery(ctx, {scope, eventId})` for current delivery state, attempt count,
provider identifier, optional acceptance receipt and observed validation errors.
`provider_accepted` means transport acceptance. It does not prove successful
aggregation, invoice inclusion, finalization or payment. Keep the original ledger
receipt and later observations separate.

`holdDelivery` prevents future sends. It cannot abort an in-flight native request;
a later accepted receipt remains visible even while the administrative hold flag
is set. `resumeDelivery` clears a hold and starts or resumes compatible work after
known retryable failures. It never blindly replays unknown effects or expired
windows. Native Stripe has no per-event retrieve API that proves the fate of an
unknown submission. An aggregate total cannot prove an individual event's fate.
Investigate provider logs and reconciliation before any financial correction.

`cancelDelivery` returns a typed unsupported result. Holding work is not native
cancellation, an adjustment or a refund. Use the separately implemented correction
workflow when available and preserve the original event and payment provenance.
No deletion or financial-history cleanup API is provided here.

## Receive asynchronous native validation errors

Configure a Stripe **thin** event destination for:

- `v1.billing.meter.error_report_triggered`
- `v1.billing.meter.no_meter_found`

Use the BetterStripe webhook route and configure its thin destination secret as
`webhookSecretV2`. The `v1.` names still carry thin payloads. The package selects
the thin signature verifier, retrieves the full event from Stripe, verifies its
account/mode and maps allowlisted sample identifiers to their original outbox
records. Destination/account context must match the configured key's own realm.
Organization or foreign account contexts are not silently substituted.

Observed errors are append-only and deduplicated by native report/event/code.
They do not overwrite transport acceptance or invoice history. Reads include at
most 20 errors plus `validationHistoryComplete` for this bounded local history.
This flag does not claim complete provider validation. Stripe reports samples;
unmatched identifiers, unsupported codes and truncated reports cannot prove that
all affected events were observed. The adapter bounds a report to 100 matched
samples, reports truncation and discards raw error messages and metadata.

Test locally with Stripe's thin-event forwarding and meter-error triggers before
production. Use the sandbox and verify webhook signatures. See Stripe's
[recording and error guide](https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage-api),
[event creation contract](https://docs.stripe.com/api/billing/meter-event/create)
and [finite idempotency retention](https://docs.stripe.com/api/idempotent_requests).
