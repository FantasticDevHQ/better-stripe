# Plan 010: Design spike — subscription write surface (pause/resume, plan change, metadata)

> **Executor instructions**: This is a DESIGN SPIKE — the deliverable is a
> design document, **not code**. Do not modify any file outside the
> deliverable path. Follow the investigation steps, answer the listed
> questions with evidence, and write the design doc. If anything in the
> "STOP conditions" section occurs, stop and report. When done, update the
> status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 7cbbd55..HEAD -- src/client/billing/subscriptions.ts src/client/webhooks/`
> On significant drift, re-verify the "Current state" claims before writing.

## Status

- **Priority**: P3
- **Effort**: M (investigation + writing; implementation is a future plan)
- **Risk**: LOW (no code changes)
- **Depends on**: none (but read plans/002 and 006 for in-flight query/error decisions)
- **Category**: direction
- **Planned at**: commit `7cbbd55`, 2026-06-11

## Why this matters

The component's subscription READ surface is comprehensive (8 query methods),
but the WRITE surface is only `cancelSubscription`, `reactivateSubscription`,
and `updateSubscriptionQuantity` (`src/client/billing/subscriptions.ts:35–74`).
There is no pause/resume (the schema already has a `"paused"` status in the
subscription status union — `src/client/billing/subscriptions.ts:156–163`
lists it — yet nothing in the component can produce it), no plan/price change,
and no metadata update. Consumers who need these will call
`stripe.subscriptions.update()` directly, which bypasses the component and —
worse — the trigger/sync guarantees the component exists to provide. The
asymmetry is the evidence this surface is wanted; the design questions below
are why it's a spike and not a build plan.

## Current state (verified evidence)

- Existing write methods are thin SDK wrappers returning `{ success: true }`,
  relying on the webhook (`customer.subscription.updated`) to sync state back
  into the component DB. Example, `subscriptions.ts:53–62`:

```typescript
export async function reactivateSubscription(
  stripe: Stripe, _ctx: RunCtx,
  opts: { stripeSubscriptionId: string },
) {
  await stripe.subscriptions.update(opts.stripeSubscriptionId, {
    cancel_at_period_end: false,
  });
  return { success: true };
}
```

- The `"paused"` status exists in the upsert validator's status union but no
  method sets `pause_collection`.
- The example app's billing page (`example/src/pages/dashboard/billing.tsx`)
  exposes only cancel/reactivate — no pause or plan-change UI exists to copy.
- Webhook sync path: `customer.subscription.updated` →
  `src/client/webhooks/processors.ts` `upsertSubscriptionFromStripe` — any
  write made via the SDK is eventually mirrored, so new write methods get
  sync "for free" as long as the event fires.

## Deliverable

ONE file: `plans/outputs/010-subscription-write-surface-design.md` (create
the `plans/outputs/` directory). Sections:

1. **Proposed API** — for each method: name, options object, return shape,
   and the exact Stripe call. Candidate set to evaluate (adopt/drop each with
   one line of reasoning):
   - `pauseSubscription({ stripeSubscriptionId, behavior?, resumesAt? })` → `pause_collection`
   - `resumeSubscription({ stripeSubscriptionId })` → `pause_collection: ""`/null
   - `updateSubscriptionPrice({ stripeSubscriptionId, stripePriceId, prorationBehavior? })` → items[0] price swap
   - `updateSubscriptionMetadata({ stripeSubscriptionId, metadata })`
   - `updateSubscriptionTrialEnd({ stripeSubscriptionId, trialEnd })`
2. **Consistency decisions** — match existing conventions and say so:
   `{ success: true }` returns vs richer returns; errors via
   `throwStripeError` (post-Plan-006 convention); webhook-sync vs immediate
   local upsert (existing methods rely on webhook sync — keep or change, with
   reasoning about the window where local state is stale).
3. **V2-accounts caveats** — investigate (Stripe docs / SDK types): does
   `pause_collection` behave identically for subscriptions whose customer is
   a V2 `customer_account`? Does a price swap fire `customer.subscription.updated`
   with the new item? Record findings WITH sources (doc URLs or SDK type
   references), and mark anything unverifiable as an open question.
4. **Multi-item subscriptions** — `updateSubscriptionQuantity` already
   assumes `items.data[0]` (subscriptions.ts:70). State whether the new
   methods keep that assumption (recommended for consistency) and the
   documented limitation.
5. **Test plan sketch** — unit tests per method (Plan 005's mock pattern) +
   which `stripe trigger` events the E2E harness could assert.
6. **Open questions for the maintainer** — anything genuinely undecidable
   from the repo (e.g. should pause fire a dedicated async hook like
   `onSubscriptionPaused`, or reuse `onSubscriptionUpdated`?).
7. **Effort estimate** for the implementation plan.

## Commands you will need

| Purpose | Command | Expected |
| ------- | ------- | -------- |
| Inspect SDK types for pause_collection | `grep -rn "pause_collection" node_modules/stripe/types/ \| head` | type references to cite |
| Confirm no existing pause support | `grep -rn "pause" src/ --include="*.ts" -l` | review hits |

## Scope

**In scope**: `plans/outputs/010-subscription-write-surface-design.md` (the only file you create/modify, besides the index status row).

**Out of scope**: ALL source code. No prototype implementations.

## Steps

1. Read `src/client/billing/subscriptions.ts` in full, plus how the facade in
   `src/client/index.ts` exposes the existing three write methods (signatures,
   action vs mutation context).
2. Investigate the SDK types for `SubscriptionUpdateParams`
   (`pause_collection`, `items`, `proration_behavior`, `trial_end`) and note
   exact type names for the doc.
3. Check the webhook event constants
   (`src/client/utils/webhookEndpoints.ts`) — confirm
   `customer.subscription.updated` is subscribed (it is, per README) so new
   writes sync back; note any event the new methods would need that is NOT in
   the list.
4. Write the deliverable.

**Verify**: deliverable exists, every claim in section 3 has a source, and every candidate method in section 1 has an adopt/drop verdict.

## Done criteria

- [ ] `plans/outputs/010-subscription-write-surface-design.md` exists with all 7 sections
- [ ] No source files modified (`git status` shows only the new doc + index)
- [ ] `plans/README.md` status row updated

## STOP conditions

- You cannot determine V2-account behavior for `pause_collection` from SDK
  types or docs — write it as an open question with a proposed live-test via
  the E2E harness; do NOT guess silently.

## Maintenance notes

- The implementation plan that follows this spike should be written only
  after the maintainer answers the open questions; it will follow Plan 005's
  test pattern and Plan 006's error convention.
