# Refunds and Disputes Design Spike

> Plan 011 — output document. No source files were modified.

---

## 1. Event Model Investigation

### Refund events

The Stripe SDK (`node_modules/stripe/cjs/resources/Events.d.ts`, line 78) lists the following refund-related V1 event types in the `Event.Type` union:

- `refund.created` — payload: `Refund` object (`RefundCreatedEvent`, line 2466)
- `refund.updated` — payload: `Refund` object (`RefundUpdatedEvent`, line 2492)
- `refund.failed` — payload: `Refund` object (`RefundFailedEvent`, line 2479)
- `charge.refunded` — payload: `Charge` object, **not** `Refund` (`ChargeRefundedEvent`, line 620). SDK JSDoc: "Occurs whenever a charge is refunded, including partial refunds. Listen to `refund.created` for information about the refund."
- `charge.refund.updated` — payload: `Refund` object (`ChargeRefundUpdatedEvent`, line 607). SDK JSDoc: "Occurs whenever a refund is updated on selected payment methods. For updates on all refunds, listen to `refund.updated` instead."

**Recommended event set for refunds:** `refund.created`, `refund.updated`, `refund.failed`.

Do **not** subscribe to `charge.refunded`: its payload is a `Charge` object, and Stripe's own JSDoc says to listen to `refund.created` for refund data. `charge.refund.updated` is a legacy partial-update event for specific payment methods; `refund.updated` is the canonical choice.

### Dispute events

The SDK (`node_modules/stripe/cjs/resources/Events.d.ts`, line 504–556) lists:

- `charge.dispute.created` — payload: `Dispute` (`ChargeDisputeCreatedEvent`, line 516)
- `charge.dispute.updated` — payload: `Dispute` (`ChargeDisputeUpdatedEvent`, line 555)
- `charge.dispute.closed` — payload: `Dispute` (`ChargeDisputeClosedEvent`, line 503)
- `charge.dispute.funds_withdrawn` — payload: `Dispute` (`ChargeDisputeFundsWithdrawnEvent`, line 542)
- `charge.dispute.funds_reinstated` — payload: `Dispute` (`ChargeDisputeFundsReinstatedEvent`, line 529)

**Recommended event set for disputes:** `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`.

All five carry a `Dispute` snapshot, making them straightforward upserts on a single table.

### Payment-intent linkage

Both objects reference payment intents directly in the SDK:

- `Refund.payment_intent: string | PaymentIntent | null` (`Refunds.d.ts`, line 98) — direct reference to the PI that was refunded.
- `Dispute.payment_intent: string | PaymentIntent | null` (`Disputes.d.ts`, line 84) — direct reference to the PI under dispute.

Both objects also carry `charge: string | Charge | null/never-null` (Refund line 64, Dispute line 50), which is the intermediate charge object. The component tracks **payment intents**, not charges, so the link field to store in both tables is `stripePaymentIntentId` (extracted from `event.data.object.payment_intent`, stripping the expanded object to its `id`). The processor must handle the `null` case: very old charge-only flows (created before PaymentIntents) set `payment_intent` to `null`. In that case the processor can still extract the charge ID via `refund.charge` and include it in a separate `stripeChargeId` field, but the `payments` row join should use `stripePaymentIntentId` only when non-null.

### V1 snapshot vs. V2 thin event compatibility

All six recommended events (`refund.created`, `refund.updated`, `refund.failed`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`) are V1 snapshot events. They are in the `Event.Type` union in the SDK (`Events.d.ts`, line 78), carry full object snapshots in `event.data.object`, and are verified via `stripe.webhooks.constructEventAsync` — exactly the existing V1 path in `handler.ts`.

**No third destination is needed.** These events are added to `BETTER_STRIPE_WEBHOOK_EVENTS` (the snapshot list) in `src/client/utils/webhookEndpoints.ts`. Consumers who call `setupEventDestination` with `eventPayload: "snapshot"` (or use the legacy `createWebhookEndpoint`) only need to add the new names to `enabledEvents`; the existing snapshot destination handles them. The STOP condition (SDK types contradicting V1 snapshot delivery) does not apply here.

---

## 2. Schema Proposal

### `refunds` table

**Validators sketch** (`src/component/connect/validators.ts` additions):

```typescript
export const refundStatusValidator = v.union(
  v.literal("pending"),
  v.literal("requires_action"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("canceled"),
);
export type RefundStatus = Infer<typeof refundStatusValidator>;

export const refundReasonValidator = v.union(
  v.literal("duplicate"),
  v.literal("fraudulent"),
  v.literal("requested_by_customer"),
  v.literal("expired_uncaptured_charge"),
);
export type RefundReason = Infer<typeof refundReasonValidator>;

export const refundFields = {
  stripeRefundId: v.string(),
  stripePaymentIntentId: v.optional(v.string()),  // null on legacy charge-only flows
  stripeChargeId: v.optional(v.string()),           // always available, fallback join key
  accountId: v.optional(v.string()),                // Connect account if applicable
  amount: v.number(),
  currency: v.string(),
  status: refundStatusValidator,
  reason: v.optional(refundReasonValidator),         // null when Stripe-generated or unset
  failureReason: v.optional(v.string()),             // Refund.failure_reason (string enum per docs)
  metadata: v.optional(v.any()),
};
```

Status values sourced from `Refunds.d.ts` line 117 JSDoc: "This can be `pending`, `requires_action`, `succeeded`, `failed`, or `canceled`." The SDK types `status` as `string | null` (not a union), so we enumerate manually from the documented values.

Reason values sourced from `Refund.Reason` type alias at `Refunds.d.ts` line 186: `'duplicate' | 'expired_uncaptured_charge' | 'fraudulent' | 'requested_by_customer'`.

**Table + indexes** (`src/component/connect/schema.ts` addition):

```typescript
export const refundsTable = defineTable(refundFields)
  .index("by_stripe_refund_id", ["stripeRefundId"])
  .index("by_stripe_payment_intent_id", ["stripePaymentIntentId"])
  .index("by_account_id", ["accountId"])
  .index("by_account_id_and_status", ["accountId", "status"])
  .index("by_payment_intent_id_and_status", ["stripePaymentIntentId", "status"]);
```

Compound indexes `by_account_id_and_status` and `by_payment_intent_id_and_status` follow Plan 002's lesson: filtered list queries (e.g., "all failed refunds for account X") need compound indexes, never filter-after-take.

**Link to `payments` rows:** join via `stripePaymentIntentId` against the `by_stripe_payment_intent_id` index on the `payments` table. No foreign key column needed — Convex's Ent pattern uses index lookups, not FK constraints.

---

### `disputes` table

**Validators sketch** (`src/component/connect/validators.ts` additions):

```typescript
export const disputeStatusValidator = v.union(
  v.literal("warning_needs_response"),
  v.literal("warning_under_review"),
  v.literal("warning_closed"),
  v.literal("needs_response"),
  v.literal("under_review"),
  v.literal("won"),
  v.literal("lost"),
  v.literal("prevented"),
);
export type DisputeStatus = Infer<typeof disputeStatusValidator>;
```

Status values sourced from `Dispute.Status` type alias at `Disputes.d.ts` line 237: `'lost' | 'needs_response' | 'prevented' | 'under_review' | 'warning_closed' | 'warning_needs_response' | 'warning_under_review' | 'won'`.

```typescript
export const disputeFields = {
  stripeDisputeId: v.string(),
  stripePaymentIntentId: v.optional(v.string()),  // Dispute.payment_intent (Disputes.d.ts line 84)
  stripeChargeId: v.optional(v.string()),           // Dispute.charge (Disputes.d.ts line 50) — always present
  accountId: v.optional(v.string()),                // Connect account if applicable
  amount: v.number(),
  currency: v.string(),
  status: disputeStatusValidator,
  reason: v.string(),                               // Dispute.reason is string (no union in SDK)
  isChargeRefundable: v.boolean(),
  fundsWithdrawn: v.optional(v.boolean()),          // derived from seeing funds_withdrawn event
  fundsReinstated: v.optional(v.boolean()),         // derived from seeing funds_reinstated event
  metadata: v.optional(v.any()),
};
```

The `Dispute.reason` field is typed as `string` (not a union) in `Disputes.d.ts` line 89; the possible values are listed in JSDoc but not as a TypeScript union, so we store it as `v.string()`.

**Table + indexes** (`src/component/connect/schema.ts` addition):

```typescript
export const disputesTable = defineTable(disputeFields)
  .index("by_stripe_dispute_id", ["stripeDisputeId"])
  .index("by_stripe_payment_intent_id", ["stripePaymentIntentId"])
  .index("by_account_id", ["accountId"])
  .index("by_account_id_and_status", ["accountId", "status"])
  .index("by_payment_intent_id_and_status", ["stripePaymentIntentId", "status"]);
```

**Link to `payments` rows:** same strategy as refunds — join on `stripePaymentIntentId` against the `payments` table's `by_stripe_payment_intent_id` index.

---

## 3. Trigger/Hook Surface

### New sync dispatchers

Following the `TriggerDispatcherName` pattern in `src/client/types/triggers.ts` (line 198–206), add:

- `refundUpserted` — fires on `refund.created`, `refund.updated`, `refund.failed`
- `disputeUpserted` — fires on all five `charge.dispute.*` events

### New async hooks

Following `AsyncHookName` in `src/client/types/triggers.ts` (line 209–218), add:

- `afterRefundCreated` — hook ref name for `refund.created`; fired after `refundUpserted` commits
- `afterDisputeCreated` — hook ref name for `charge.dispute.created`; fired after `disputeUpserted` commits
- `afterDisputeClosed` — hook ref name for `charge.dispute.closed`; fired after `disputeUpserted` commits on the `closed`/`won`/`lost` transition

The `HOOK_EVENT_MAP` in `src/client/webhooks/hooks.ts` (line 55) would gain three entries.

The `SyncTriggers` interface in `src/client/types/triggers.ts` would gain:

```typescript
refund?: {
  onCreate?: (ctx: SyncTriggerCtx, doc: StripeComponentRefund) => Promise<void>;
  onUpdate?: (ctx: SyncTriggerCtx, newDoc: StripeComponentRefund, oldDoc: StripeComponentRefund) => Promise<void>;
};
dispute?: {
  onCreate?: (ctx: SyncTriggerCtx, doc: StripeComponentDispute) => Promise<void>;
  onUpdate?: (ctx: SyncTriggerCtx, newDoc: StripeComponentDispute, oldDoc: StripeComponentDispute) => Promise<void>;
};
```

The `AsyncHooks` interface would gain:

```typescript
onRefundCreated?: (ctx: AsyncHookCtx, refund: StripeComponentRefund) => Promise<void>;
onDisputeCreated?: (ctx: AsyncHookCtx, dispute: StripeComponentDispute) => Promise<void>;
onDisputeClosed?: (ctx: AsyncHookCtx, dispute: StripeComponentDispute) => Promise<void>;
```

### Breaking change impact on `triggersApi()` export contract

**This is a breaking change.** Adding new names to `TriggerDispatcherName` and `AsyncHookName` expands the `TriggerApiRefs` type and the object returned by `triggersApi()`. Apps that destructure all names from `triggersApi()` must add the new names to their Convex module. Apps that already pass `triggers: internal.stripe` with a partial spread are **not** broken (all fields are `Partial<>`), but the exported name list grows from 18 to 23 (2 dispatchers + 3 async hooks).

The CHANGELOG.md Unreleased block (line 7) documents the precedent: the previous trigger-contract break listed all 18 names and explained the migration. The same pattern should be followed: list all 23 names, note the new additions, and provide a migration note ("add `refundUpserted`, `disputeUpserted`, `afterRefundCreated`, `afterDisputeCreated`, `afterDisputeClosed` to your Convex stripe module export").

---

## 4. Payment-Status Interplay

**Recommendation: patch the `payments` row.**

When a `charge.refunded` or `refund.created` event arrives, the processor should check whether the linked `payments` row has been fully or partially refunded and update it with a derived status value. Specifically, add two optional fields to `paymentFields`:

- `refundedAmount: v.optional(v.number())` — cumulative refunded cents
- `refundStatus: v.optional(v.union(v.literal("partially_refunded"), v.literal("fully_refunded")))` — derived flag

**Reasoning:** The primary use case this component targets is the marketplace/Connect split-payout flow. When an app splits funds on `afterPaymentSucceeded`, it needs a single authoritative query to know "is this payment still whole?" Without a flag on `payments`, the app must query the `refunds` table and sum amounts — which is two queries and application-layer arithmetic. A denormalized flag on the `payments` row makes the common case a single document read.

The refunds table remains the authoritative record (amount, reason, status per refund). The flag on `payments` is only the high-level question: "has money come back?" This is the same pattern Stripe itself uses: the `Charge` object has a `refunded: boolean` and `amount_refunded: number` alongside the separate `Refunds` list.

The processor for `refund.created`/`refund.updated` should: (a) upsert the `refunds` row, (b) look up the linked `payments` row, (c) sum all `refunds` for that `stripePaymentIntentId`, and (d) patch `refundedAmount` and `refundStatus` on the `payments` row — all in the same `refundUpserted` dispatcher transaction.

Dispute events should **not** patch `payments` status: the dispute is not yet resolved when it arrives, and patching `payments` to "disputed" and then reverting it when the dispute is won creates thrash. Instead, the `disputes` table is the sole authority on dispute state; the app consults it when needed.

---

## 5. Explicitly Out of Scope

### Connect transfer reversals (`transfer.reversed`)

The `transfer.reversed` event is present in the SDK's `Event.Type` union (`Events.d.ts`, line 78) and is fired when a transfer to a connected account is reversed. For the marketplace split-payout pattern, a transfer reversal is the counterpart to a refund: when you refund a charge, Stripe can automatically reverse the associated transfer.

**Deferred.** Transfer reversals are tightly coupled to how the platform originally split funds (destination charges vs. separate charges vs. top-level charges). The component does not currently track transfers at all — there is no `transfers` table. Adding transfer reversal tracking before transfers are tracked would create a dangling reference. The correct order is: (1) add refunds/disputes (this plan), (2) decide whether to track transfers, (3) add transfer reversals as a child of that. Include a note in the implementation plan that platforms using automatic transfer reversals should listen to `transfer.reversed` and handle it manually in their `onRefundCreated` hook until the component adds native transfer tracking.

### Application-fee refunds

The `application_fee.refunded` event and the `application_fee.refund.updated` event are in the SDK's `Event.Type` union. They fire when a platform refunds the application fee taken from a connected account's charge.

**Deferred.** Application fees are also not tracked in the current schema — there is no `applicationFees` table. Adding application-fee refund tracking without first tracking application fees would produce the same dangling-reference problem as transfer reversals. These events are low-volume (one per manual refund of an application fee), and the primary concern for correctness (reversed money flow on the platform) is captured by the refunds table. Platforms that need to reconcile application-fee refunds can subscribe to `application_fee.refunded` in their own `onEvent` hook until the component adds native tracking.

---

## 6. E2E Verifiability

Verified against `stripe trigger --help` output (Stripe CLI v1.42 present in this environment):

| Event | `stripe trigger` supported? |
|---|---|
| `charge.dispute.created` | Yes |
| `charge.dispute.updated` | Yes |
| `charge.dispute.closed` | Yes |
| `charge.dispute.funds_withdrawn` | Not listed |
| `charge.dispute.funds_reinstated` | Not listed |
| `refund.created` | Not listed |
| `refund.updated` | Not listed |
| `refund.failed` | Not listed |
| `charge.refunded` | Yes (but not recommended — Charge payload) |

`charge.dispute.created`, `charge.dispute.updated`, and `charge.dispute.closed` can be added to the `v1Events` array in `example/scripts/e2e-webhooks.ts` directly.

`refund.created` and `refund.updated` are not in the `stripe trigger` supported-events list. For E2E coverage, the script can create a real PaymentIntent, confirm it via `stripe.paymentIntents.confirm`, then call `stripe.refunds.create` via the API — the resulting webhook event is real and Stripe-signed, so `stripe listen --forward-to` delivers it through the same pipeline. This is the same approach used for `payout.paid` (a real API call rather than `stripe trigger`).

`charge.dispute.funds_withdrawn` and `charge.dispute.funds_reinstated` cannot be reliably triggered in test mode without Stripe support tooling; mark them as SKIP in the E2E table with a note.

---

## 7. Effort Estimate and Suggested Split

**Estimate: L** (matches expectation from the plan file).

The pattern is established and the nine files per domain are well-understood. The complexity is in the cross-table patch (refund → payments row) and in the async dispatch for two dispatcher types rather than one. L is appropriate; this is not XL because no new architectural patterns are needed.

**Suggested split:**

**Phase A: Refunds** (independently shippable)

Includes: `refundStatusValidator`, `refundReasonValidator`, `refundFields`/`refundDocValidator` in validators; `refundsTable` in schema; `upsertRefund` mutation; `getRefundByStripeId`, `listRefunds` queries; `handleRefundEvent` processor handling `refund.created`/`refund.updated`/`refund.failed`; `refundUpserted` dispatcher + `afterRefundCreated` async hook; `BETTER_STRIPE_WEBHOOK_EVENTS` extended with 3 events; `SyncTriggers.refund`, `AsyncHooks.onRefundCreated`; `payments` row patch for `refundedAmount`/`refundStatus`; client facade `src/client/connect/refunds.ts`; README updates.

**Phase B: Disputes** (independently shippable after Phase A or in parallel)

Includes: `disputeStatusValidator`, `disputeFields`/`disputeDocValidator` in validators; `disputesTable` in schema; `upsertDispute` mutation; `getDisputeByStripeId`, `listDisputes` queries; `handleDisputeEvent` processor handling all five `charge.dispute.*` events; `disputeUpserted` dispatcher + `afterDisputeCreated`/`afterDisputeClosed` async hooks; `BETTER_STRIPE_WEBHOOK_EVENTS` extended with 5 events; `SyncTriggers.dispute`, `AsyncHooks.onDisputeCreated`/`onDisputeClosed`; client facade `src/client/connect/disputes.ts`; README updates.

Both phases increment the `triggersApi()` export list (breaking change note required in CHANGELOG).

---

## 8. Open Questions for the Maintainer

1. **Legacy charge-only flows**: The component currently stores `stripePaymentIntentId` as the primary key on `payments`. Refunds on charges that predate PaymentIntents (rare in new integrations, possible in older accounts) have `refund.payment_intent = null`. Should these refunds be stored with only `stripeChargeId`, or silently skipped if `payment_intent` is null? Recommendation: store them with `stripeChargeId` only and log a warning; this avoids data loss but means the payments-row cross-table patch is skipped for those refunds.

2. **Partial-refund `refundStatus` field placement**: The proposal adds `refundedAmount` and `refundStatus` to `paymentFields`. This is a schema migration for all existing deployments. Is a migration step acceptable for a minor version bump, or should this be deferred to a 1.0 milestone where breaking schema changes are expected?

3. **Dispute `reason` field**: The Stripe SDK types `Dispute.reason` as `string` with the valid values listed only in JSDoc (`Disputes.d.ts` line 87–89: `bank_cannot_process`, `check_returned`, `credit_not_processed`, etc.). Should the validator use `v.string()` (flexible but unvalidated) or a strict union of the 14 documented reason codes? A strict union would break if Stripe adds a new reason code without a component release. Recommendation: `v.string()` with a comment listing current documented values.

4. **`funds_withdrawn` / `funds_reinstated` tracking**: The `fundsWithdrawn` / `fundsReinstated` boolean fields proposed in `disputeFields` are derived state (not directly on the Stripe `Dispute` object — they are separate events). An alternative is to record the event type that triggered the upsert as a `lastEvent` string field, letting apps react to the specific financial event rather than inferring it from a boolean. Which approach does the maintainer prefer?

5. **E2E coverage for `refund.created` via API**: The plan proposes creating a PaymentIntent and refunding it via API call rather than `stripe trigger`. This requires a real charge (or test mode charge) to exist. Should the E2E script manage this setup/teardown, or should refund E2E coverage be deferred until Stripe CLI gains `stripe trigger refund.created` support?

6. **`TriggerApiRefs` export name growth**: After Phase A + Phase B, the `triggersApi()` export grows from 18 to 23 names. The CHANGELOG Unreleased block currently lists all 18. Should the implementation plan keep listing all names in full, or switch to listing only additions after the initial full-list release?
