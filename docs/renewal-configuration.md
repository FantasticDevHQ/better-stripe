# Configure an attached renewal schedule

Use `BetterStripe` from `@fantastic.dev/better-stripe/node` in a Convex Node
action. Call `configureRenewalSchedule` after a successful
`attachRenewalSchedule` on the **same SDK instance and action context**, within
the original attachment deadline. The method consumes private live attachment
authority once. Journal data cannot recreate it after a restart or another action.

The configured price starts at the provider-verified existing paid period end.
The current phase keeps its paid price, quantity, dates and supported settings.
The method makes at most one schedule-update POST and never attaches implicitly.
The result `configure_acknowledged` means the provider response and receipt were
retained. It does not claim a pending or effective replacement. Provider
observation, successor correlation, restart recovery and explicit replay are
separate capabilities. Dojo owns consent, membership, tier direction, access and
entitlements.

## Prepare and retain the configure identity

After authorizing journal reads, load the attachment operation and ACK. Pass the
original operation record, active attempt descriptors and exact receipt to the
pure helper. Keep the logical identity, configure key and first dispatch time in
durable host state before invoking configuration. Never regenerate them after an
unknown result.

```ts
import { prepareRenewalConfigurationOperation } from "@fantastic.dev/better-stripe/node";

const parent = await ctx.runQuery(refs.queries.loadAuthorizedOperation, {
  operationId: attachmentOperationId,
});
const ack = await ctx.runQuery(refs.queries.readProviderAcknowledgement, {
  operationId: attachmentOperationId,
});
if (!parent?.activeAttempt || !ack) throw new Error("Attachment ACK required");
const prepared = await prepareRenewalConfigurationOperation({
  attachment: {
    operationId: attachmentOperationId,
    recordJSON: parent.recordJSON,
    attemptId: parent.activeAttempt.attemptId,
    sourcePayloadId: parent.activeAttempt.payloadId,
    receiptJSON: ack.receiptJSON,
  },
  authorization: { scope: hostScope, id: consentId, revision: consentRevision },
  logicalOperationId: configureOperationId,
  configureKey, // Caller-retained, distinct from the attach key.
  firstDispatchedAt, // Original Unix seconds for this configure identity.
});
const operation = await ctx.runMutation(
  refs.mutations.createAuthorizedOperation,
  prepared.createArgs,
);
if (operation.status === "conflict") return operation;
return betterStripe.configureRenewalSchedule(ctx, {
  operationId: operation.operationId,
  requestBinding: prepared.requestBinding,
  authorizationQuery: internal.renewalAuthorization.authorizeConfiguration,
});
```

`refs` is `components.betterStripe.renewalOperations`. Authenticate creation and
readback in host code. The authorization query must return exactly `true`. It
receives `capability: "renewal_configuration_v1"`, the configure `operationId`,
`attachmentOperationId`, authorization scope/id/revision, logical operation ID,
request binding and all expected original/target/period selectors. Verify the
current actor and consent for those exact selectors. Keep the query reference in
trusted server code. Authorization precedes reservation and provider reads.

The helper retains a complete canonical payload and binds the configure record to
the attachment operation, attempt, source payload and receipt. The component
retains the configure attempt, dispatch/response/receipt events and ACK. Read
these through the same `loadAuthorizedOperation`, `readAttempt`, `readStageEvent`
and `readProviderAcknowledgement` queries using the configure operation ID.

## Supported profile and limits

The source-bound profile is `node-endive-configure-v1`, using
`2026-09-30.endive`, platform test mode, classic billing, an ordinary anchor and
the same recurring cadence and currency. Live credentials are refused. A target
price on another product is supported. Quantity must be a positive safe integer.
Both discount lists must be explicitly empty and the customer discount null.

The qualified path accepts null or exact inactive
`managed_payments: { enabled: false }`, and the exact inactive trial default
`trial_settings.end_behavior` with `billing_cycle_anchor: "now"` and
`missing_payment_method: "create_invoice"` only with null trial start/end. Full
raw source and defaults remain retained and compared. Legacy projection without
the explicit execution profile keeps its conservative guards.

Unsupported material is refused before a provider write. This includes flexible
billing, calendar-edge anchors, changed cadence/currency, metered or multiple
items, discounts, active trials, scheduled cancellation, paused subscriptions,
billing thresholds, pending updates/setup/invoice items, enabled managed payments,
nondefault trial settings and unknown phase/default fields. Supported tax,
collection/payment/invoice, routing, fees, on-behalf-of, descriptions and metadata
must pass the lossless phase mappings and inheritance checks. Ambiguous null,
unset, inheritance or reference changes are refused rather than omitted.

The method rereads the exact subscription, target, customer and acknowledged
schedule before dispatch and checks their complete captured material. Existing
unrelated schedules, changed defaults and already-configured schedules fail the
baseline guard. These checks are best-effort fences, not an atomic provider
compare-and-swap. Hosts must coordinate concurrent writers.

Configuration shares the attachment's original 30-second work deadline and
35-second outer bound, including the original monotonic clock basis. It never
refreshes the window. A new SDK instance, action or process has no live authority.

`not_dispatched` reports refusal; `conflict` reports changed identity, a consumed
attempt or provider conflict. `unknown` and `timeout` leave the write outcome
uncertain. Duplicate calls make no additional POST. There is no automatic retry,
key rotation, unkeyed fallback, rollback, cancel/release or retained-key replay.
Preserve failed and unknown window identities for investigation. Do not mint a
new operation to bypass an unknown result.

## Sandbox probe

The opt-in probe documented in [renewal attachment](./renewal-attachment.md) now
also configures the acknowledged fixture, reads back both phase prices, quantity
and renewal boundary, checks duplicate refusal and retained ACK. It uses real
Stripe with a Convex-test journal in Node, not a serving deployed backend. A
skipped run supplies no provider evidence. The PR records the actual run and
cleanup. Unknown configure outcomes hold the schedule for investigation.
