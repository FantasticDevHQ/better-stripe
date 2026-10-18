# Record usage atomically

`stripe.usage.record`, `get` and `read` are trusted host APIs. The host must
authenticate the actor, authorize the exact Stripe realm/payer/meter and resolve
the native customer, subscription, item and price from verified server state.
Use `authorizeUsageRecord` to run authorization and billable-activity policy before
calling the facade. Browser-supplied account IDs and prices are not authorization.

```ts
import { authorizeUsageRecord } from "@fantastic.dev/better-stripe/usage";

// In a host mutation, resolve these from authenticated, persisted activity.
const receipt = await authorizeUsageRecord(ctx, policy, serverEvent, (event) =>
  stripe.usage.record(ctx, { event, subscription: verifiedSubscription }),
);
```

Acceptance writes an immutable event, durable outbox row and retained-scope counter
in one Convex transaction. An optional `dispatch` handle schedules an internal
host action in that transaction. Create the handle on the server; never accept it
from a browser. Scheduling failure rolls back acceptance, counter changes and any
reservation commit. Without dispatch, the outbox stays queued for later delivery.
Recording does not contact Stripe or prove billing, aggregation or payment.

Use stable source-event IDs. Equal replay returns the original acceptance receipt,
including after the event's delivery window expires. A changed quantity, occurrence
time, mapped customer, plan/version, currency, price or subscription snapshot
conflicts. Realm, payer, meter and test/live mode are independent scopes. A source
ID reused in a different authorized scope is an independent event, not permission
to alter the original. Do not move activity between scopes to repair a failure.

Quantities use the shared exact decimal contract and integer scaled representation.
New occurrence times must be within Stripe's 35-day past/5-minute future window
and the immutable half-open subscription period. The price must match that
subscription binding. The component assigns acceptance time in Unix seconds.
Payloads are limited to 8 KiB and subscription snapshots to 2 KiB, measured as UTF-8.
No arbitrary event metadata, secret or user payload is accepted.

The default quota is 100,000 retained events per scope. A host may select a lower
`quota`, from 1 to 100,000. Exhaustion rejects new work and preserves history.
Replays do not consume quota. Export and reconcile bounded pages before planning
future archival; this implementation has no financial-history deletion API.
Do not clear the tables to reset a quota or repair unresolved usage.

Prepaid recording requires a matching component-owned reservation and atomically
commits it with the event. The scope, source ID, exact quantity and immutable plan
must match. No arbitrary reservation-creation API exists. Payment-backed grant and
reservation provisioning is implemented in the credit-accounting ticket; until
then the facade rejects prepaid events without such a reservation. Included-usage
snapshots use the same ledger; strict allowance reservations can use the same
atomic commit seam when allowance accounting is enabled.

`get(ctx, {scope, eventId})` returns null for a foreign scope or absent event.
`read(ctx, {scope, page: {period: {start, end}, limit, cursor}})` returns `events`,
`cursor` and `isDone`. It uses an indexed range and bounds pages to 1–100 events.
The acceptance receipt always records initial queued intent; the view's separate
`delivery` field reports current outbox state. Reauthorize every page. A complete
local page history does not establish complete provider aggregation or invoices.

This layer implements acceptance/history, not provider delivery or credit funding.
See [native setup](metering-setup.md), [shared contracts](metered-usage.md) and
[Stripe's native event windows](https://docs.stripe.com/api/billing/meter-event/create).
