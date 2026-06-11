# Design: Subscription Write Surface Expansion

**Plan:** 010-spike-subscription-write-surface  
**Status:** Design spike — no implementation  
**Date:** 2026-06-11

---

## 1. Proposed API

All five candidates are adopted. Reasoning per method follows.

### `pauseSubscription`

**Adopt.** `pause_collection` exists in the Stripe SDK as `SubscriptionUpdateParams.PauseCollection` (`node_modules/stripe/cjs/resources/Subscriptions.d.ts:1802`). The `"paused"` status is already in the component's status union (`src/client/billing/validators.ts`). Without this method, consumers must call `stripe.subscriptions.update` directly, bypassing component sync guarantees.

```typescript
async pauseSubscription(
  ctx: RunCtx,
  opts: {
    stripeSubscriptionId: string;
    behavior?: "keep_as_draft" | "mark_uncollectible" | "void";
    resumesAt?: number; // Unix timestamp
  },
): Promise<{ success: true }>
```

Stripe call:
```typescript
await stripe.subscriptions.update(opts.stripeSubscriptionId, {
  pause_collection: {
    behavior: opts.behavior ?? "keep_as_draft",
    ...(opts.resumesAt !== undefined ? { resumes_at: opts.resumesAt } : {}),
  },
});
```

SDK type references:
- `SubscriptionUpdateParams.pause_collection` — `Subscriptions.d.ts:1802`
- `SubscriptionUpdateParams.PauseCollection.behavior` — `Subscriptions.d.ts:1992–2001`
- `SubscriptionUpdateParams.PauseCollection.Behavior` = `'keep_as_draft' | 'mark_uncollectible' | 'void'` — `Subscriptions.d.ts:2262–2263`
- `Subscription.pause_collection: PauseCollection | null` — `Subscriptions.d.ts:223`

---

### `resumeSubscription`

**Adopt.** Resuming requires setting `pause_collection` to the Stripe empty-string sentinel (typed as `Emptyable<>` — `Subscriptions.d.ts:1802`). No separate Stripe API endpoint exists for resume; using `""` clears `pause_collection`. Without this, a paused subscription cannot be unpaused through the component.

```typescript
async resumeSubscription(
  ctx: RunCtx,
  opts: { stripeSubscriptionId: string },
): Promise<{ success: true }>
```

Stripe call:
```typescript
await stripe.subscriptions.update(opts.stripeSubscriptionId, {
  pause_collection: "",   // Emptyable<PauseCollection> — clears the field
});
```

SDK type reference: `Emptyable<SubscriptionUpdateParams.PauseCollection>` at `Subscriptions.d.ts:1802`; `Emptyable` is defined in `node_modules/stripe/cjs/shared.d.ts` as `T | ""`.

---

### `updateSubscriptionPrice`

**Adopt.** Plan/price changes are a primary billing operation. `SubscriptionUpdateParams.Item.price` (`Subscriptions.d.ts:1978`) accepts a price ID in an items array. `proration_behavior` (`Subscriptions.d.ts:1818`) controls whether an invoice is immediately generated. Omitting this forces consumers to call the SDK directly, which silently bypasses the component's webhook sync and the `subscriptionUpserted` trigger.

```typescript
async updateSubscriptionPrice(
  ctx: RunCtx,
  opts: {
    stripeSubscriptionId: string;
    stripePriceId: string;
    prorationBehavior?: "always_invoice" | "create_prorations" | "none";
  },
): Promise<{ success: true }>
```

Stripe call (retrieves the subscription first to get `items.data[0].id`, matching the pattern in `updateSubscriptionQuantity`):
```typescript
const sub = await stripe.subscriptions.retrieve(opts.stripeSubscriptionId);
const itemId = sub.items?.data?.[0]?.id;
if (!itemId) throwStripeError("SUBSCRIPTION_NOT_FOUND", "Subscription has no items");
await stripe.subscriptions.update(opts.stripeSubscriptionId, {
  items: [{ id: itemId, price: opts.stripePriceId }],
  proration_behavior: opts.prorationBehavior ?? "create_prorations",
});
```

SDK type references:
- `SubscriptionUpdateParams.items` — `Subscriptions.d.ts:1784`
- `SubscriptionUpdateParams.Item.id` — `Subscriptions.d.ts:1966`
- `SubscriptionUpdateParams.Item.price` — `Subscriptions.d.ts:1978` (note: "When changing a subscription item's price, `quantity` is set to 1 unless a `quantity` parameter is provided.")
- `SubscriptionUpdateParams.ProrationBehavior` = `'always_invoice' | 'create_prorations' | 'none'` — `Subscriptions.d.ts:2027`

---

### `updateSubscriptionMetadata`

**Adopt.** `SubscriptionUpdateParams.metadata` is typed as `Emptyable<MetadataParam>` (`Subscriptions.d.ts:1790`). Metadata updates fire `customer.subscription.updated` and are synced via `upsertSubscriptionFromStripe`, which already maps `subscription.metadata` to the component doc. Metadata is the primary escape hatch for consumer-defined fields; without this method, consumers call the SDK directly.

```typescript
async updateSubscriptionMetadata(
  ctx: RunCtx,
  opts: {
    stripeSubscriptionId: string;
    metadata: Record<string, string>;
  },
): Promise<{ success: true }>
```

Stripe call:
```typescript
await stripe.subscriptions.update(opts.stripeSubscriptionId, {
  metadata: opts.metadata,
});
```

SDK type reference: `SubscriptionUpdateParams.metadata: Emptyable<MetadataParam>` — `Subscriptions.d.ts:1790`.

---

### `updateSubscriptionTrialEnd`

**Adopt.** Trial manipulation is already a first-class concern (the component tracks `trialEnd`, `trialStart`, `isTrialing`). Extending or ending a trial mid-subscription is a common support action. `trial_end` accepts `'now' | number` (`Subscriptions.d.ts:1830`).

```typescript
async updateSubscriptionTrialEnd(
  ctx: RunCtx,
  opts: {
    stripeSubscriptionId: string;
    trialEnd: "now" | number; // Unix timestamp or "now" to end immediately
  },
): Promise<{ success: true }>
```

Stripe call:
```typescript
await stripe.subscriptions.update(opts.stripeSubscriptionId, {
  trial_end: opts.trialEnd,
});
```

SDK type references:
- `SubscriptionUpdateParams.trial_end: 'now' | number` — `Subscriptions.d.ts:1830`
- `Subscription.trial_end: number | null` — `Subscriptions.d.ts:274`

---

## 2. Consistency Decisions

### Return shape: `{ success: true }`

All five methods return `{ success: true }`, matching `cancelSubscription` (`subscriptions.ts:50`), `reactivateSubscription` (`subscriptions.ts:61`), and `updateSubscriptionQuantity` (`subscriptions.ts:73`). A richer return (e.g. the updated `Stripe.Subscription` object) was considered and rejected:

- The component's source of truth is the Convex DB, not the Stripe API response.
- Returning the Stripe object before the webhook sync commits would give callers a snapshot that is not yet reflected in the component DB, creating a confusing dual-state.
- If a caller needs the updated component doc after mutation, they should call `getSubscriptionByStripeId` after the webhook round-trip (or query immediately — the doc reflects the pre-write state until the event arrives).

### Error handling: `throwStripeError`

All new methods should wrap Stripe SDK calls in try/catch and surface failures via `throwStripeError("STRIPE_API_ERROR", ..., err)` (`src/client/errors.ts:32`). This matches the pattern used by `accountLinks.ts` and ensures errors serialize correctly across Convex action/mutation boundaries as `ConvexError<BetterStripeError>`.

The existing three write methods (`cancelSubscription`, `reactivateSubscription`, `updateSubscriptionQuantity`) do not currently wrap in try/catch — they let Stripe SDK errors propagate as raw `Error` objects. This is a pre-existing inconsistency. New methods should use `throwStripeError` (the Plan 006 convention) and the existing methods should be updated in a follow-up.

### Webhook sync vs immediate local upsert

All five new methods **rely on webhook sync** (the same approach as the existing writes). The flow is:

1. Method calls `stripe.subscriptions.update(...)`.
2. Stripe fires `customer.subscription.updated`.
3. The webhook handler calls `upsertSubscriptionFromStripe` → `dispatchUpsert(whCtx, "subscriptionUpserted", ...)`.
4. The `subscriptionUpserted` mutation upserts the component DB and fires the consumer's sync trigger in the same transaction.

This means there is a **staleness window** between the API call returning and the webhook arriving (typically < 1 second in test mode, up to several seconds in production under load). During this window `getSubscriptionByStripeId` returns the pre-mutation state.

Immediate local upsert was considered and rejected for these reasons:
- The new methods do not receive full subscription data from Stripe (only the fields they update); a partial upsert could corrupt other fields.
- `updateSubscriptionPrice` changes `priceId` and would also adjust `currentPeriodStart`/`currentPeriodEnd` (which require the full Stripe response).
- Consistency with existing methods avoids introducing a divergent sync model.

The staleness window is documented and acceptable. Consumers who need immediate consistency can call `syncAllSubscriptions` or retrieve and upsert manually.

---

## 3. V2-Accounts Caveats

### `pause_collection` and V2 customer accounts

The Stripe SDK types show that `Subscription.customer_account: string | null` is a field on the subscription object (`Subscriptions.d.ts:162`), and `SubscriptionCreateParams.customer_account?: string` / `SubscriptionUpdateParams.customer_account?: string` allow attaching a V2 `customer_account` at create/update time (`Subscriptions.d.ts:901, 2580`).

**Finding:** The `pause_collection` field is present on `SubscriptionUpdateParams` without any conditional or V2-specific typing in the SDK (`Subscriptions.d.ts:1802`). There is no SDK-level indication that `pause_collection` is unavailable or behaves differently for subscriptions attached to a V2 `customer_account`.

**Open question (unverifiable from types alone):** Stripe's V2 Accounts documentation does not appear to be represented in the SDK types with subscription-specific restrictions on `pause_collection`. However, the behavior of `pause_collection` for subscriptions whose `customer` is a V2 `customer_account` — specifically whether the subscription status transitions to `"paused"` in the same way, and whether `customer.subscription.updated` fires with `status: "paused"` — cannot be confirmed solely from type inspection.

**Proposed verification:** Use the E2E harness (`stripe trigger customer.subscription.updated`) with a V2 test account to confirm (a) the API call succeeds, (b) the returned subscription has `status: "paused"`, and (c) the webhook delivers `customer.subscription.updated` with `status: "paused"` which the processor routes to `upsertSubscriptionFromStripe` → `subscriptionUpserted`. Until this is tested, treat V2+pause as an **open question**.

### Price swap and `customer.subscription.updated`

A price swap via `items[0].price` change fires `customer.subscription.updated` with the new item in `subscription.items.data[0]`. The webhook processor (`processors.ts:168`) reads `firstItem.price.id` and syncs `priceId` to the component DB. No additional event subscription is needed.

**Source:** SDK type comment at `Subscriptions.d.ts:1976`: "When changing a subscription item's price, `quantity` is set to 1 unless a `quantity` parameter is provided." This describes a synchronous price update, not a deferred one — the `customer.subscription.updated` event carries the new state.

---

## 4. Multi-Item Subscriptions

`updateSubscriptionQuantity` already assumes `items.data[0]` (`subscriptions.ts:70`). All five new methods keep this assumption:

- `pauseSubscription` / `resumeSubscription` — operate at the subscription level (not item level); the items assumption is not relevant.
- `updateSubscriptionPrice` — targets `items.data[0].id` explicitly (same retrieve-then-update pattern as `updateSubscriptionQuantity`).
- `updateSubscriptionMetadata` — subscription-level metadata, not item-level.
- `updateSubscriptionTrialEnd` — subscription-level field.

**Documented limitation:** The price swap method (`updateSubscriptionPrice`) operates only on the first subscription item. Subscriptions with multiple items require the caller to manage item IDs directly via `stripe.subscriptionItems.update()`. This is consistent with the existing single-item assumption throughout the component. A future `updateSubscriptionItems` method accepting an explicit item array is the correct extension point, out of scope here.

---

## 5. Test Plan Sketch

### Unit tests (mockStripeInstance pattern, `src/client/index.test.ts`)

Add `subscriptions.update` mock stubs already present. New mock entries needed:
- No additions required — `mockStripeInstance.subscriptions.update` and `mockStripeInstance.subscriptions.retrieve` are already mocked (`index.test.ts:38–42`).

Per-method unit test cases:

**`pauseSubscription`**
- Calls `stripe.subscriptions.update` with `{ pause_collection: { behavior: "keep_as_draft" } }` when `behavior` is omitted.
- Passes `resumes_at` when `resumesAt` is provided.
- Returns `{ success: true }`.
- Propagates `throwStripeError("STRIPE_API_ERROR", ...)` when Stripe throws.

**`resumeSubscription`**
- Calls `stripe.subscriptions.update` with `{ pause_collection: "" }`.
- Returns `{ success: true }`.

**`updateSubscriptionPrice`**
- Retrieves the subscription to get `itemId`.
- Calls `stripe.subscriptions.update` with `{ items: [{ id: itemId, price: stripePriceId }], proration_behavior: "create_prorations" }` by default.
- Throws `throwStripeError("SUBSCRIPTION_NOT_FOUND", ...)` when `items.data` is empty.
- Passes through caller-provided `prorationBehavior`.

**`updateSubscriptionMetadata`**
- Calls `stripe.subscriptions.update` with `{ metadata: opts.metadata }`.
- Returns `{ success: true }`.

**`updateSubscriptionTrialEnd`**
- Calls `stripe.subscriptions.update` with `{ trial_end: "now" }` for immediate end.
- Calls with a numeric timestamp when provided.
- Returns `{ success: true }`.

### E2E stripe trigger assertions

The existing E2E harness (`example/src/pages/dashboard/billing.tsx` + `stripe trigger`) can exercise:

| Event to trigger | Expected component DB outcome |
|---|---|
| `stripe trigger customer.subscription.updated` (with `pause_collection`) | `status` → `"paused"` in component subscriptions table |
| `stripe trigger customer.subscription.updated` (clear `pause_collection`) | `status` → `"active"` (or prior active status) |
| `stripe trigger customer.subscription.updated` (new price in items) | `priceId` updated in component |
| `stripe trigger customer.subscription.updated` (metadata change) | `metadata` updated in component |
| `stripe trigger customer.subscription.trial_will_end` | `trialEnd` field present; existing hook already handles this event |

Note: `stripe trigger` does not have a built-in event for `pause_collection` changes. The test would need to call the pause API directly and then assert on the resulting webhook event — the same pattern used in `example/convex/example.test.ts`.

---

## 6. Open Questions for the Maintainer

1. **Pause hook granularity:** Should pausing a subscription fire a dedicated async hook `onSubscriptionPaused` (a new entry in `AsyncHooks`, `src/client/types/triggers.ts:125`), or reuse the existing `onSubscriptionUpdated`? Arguments for a dedicated hook: callers often want to trigger distinct business logic on pause (e.g., disable feature flags); the `onSubscriptionCanceled` precedent shows Stripe status-specific hooks are already the pattern. Arguments for reusing: consistency with `reactivateSubscription`, which only fires `onSubscriptionUpdated`. **Recommendation:** add `onSubscriptionPaused` as a dedicated hook, mirroring `onSubscriptionCanceled`. This requires a new `afterSubscriptionPaused` entry in `triggersApi()` and a status check in the `subscriptionUpserted` dispatcher (analogous to the `"complete"` check in `checkoutSessionUpserted`).

2. **`resumeSubscription` status after resume:** When `pause_collection` is cleared, Stripe sets the subscription back to `"active"` — but only if it was active before the pause. The component's `"paused"` → `"active"` transition depends entirely on the webhook event. Should `resumeSubscription` validate the current status before calling Stripe (i.e. refuse to resume a non-paused subscription), or leave that validation to Stripe? Current write methods do no pre-call validation.

3. **`updateSubscriptionPrice` and proration invoice timing:** The default `prorationBehavior` is proposed as `"create_prorations"` (creates proration invoices but does not immediately charge). Some use cases need `"always_invoice"` as the default. Should the component default be configurable at `BetterStripe` constructor level (like a global `defaultProrationBehavior` option)?

4. **`updateSubscriptionTrialEnd` and `billing_cycle_anchor`:** The SDK comment states: "The `billing_cycle_anchor` will be updated to the `trial_end` value." This may surprise callers expecting a future billing date to be preserved. Should the method expose `billing_cycle_anchor` as an override option?

5. **V2 + `pause_collection` live test:** As noted in Section 3, the behavior of `pause_collection` for subscriptions attached to a V2 `customer_account` is unverified. A test fixture with a V2 account subscription should be added to the E2E harness before shipping `pauseSubscription`.

---

## 7. Effort Estimate

| Task | Estimate |
|---|---|
| Implement 5 methods in `src/client/billing/subscriptions.ts` | 2–3 hours |
| Wire methods into `BetterStripe` class in `src/client/index.ts` | 30 min |
| Add unit tests to `src/client/index.test.ts` | 2–3 hours |
| Add `onSubscriptionPaused` hook (if adopted per Q1) | 1–2 hours |
| E2E test additions (stripe trigger + assertions) | 2 hours |
| Documentation / changelog | 1 hour |
| **Total** | **~9–11 hours** |

This is a single-sprint implementation task. No schema changes are required — `"paused"` is already in the status union. The webhook sync path handles all new writes automatically via `customer.subscription.updated`.
