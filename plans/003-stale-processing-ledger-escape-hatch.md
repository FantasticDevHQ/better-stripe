# Plan 003: Reprocess webhook events stuck in "processing" (staleness escape hatch)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7cbbd55..HEAD -- src/component/webhooks/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: MED (must not double-apply a genuinely in-flight event)
- **Depends on**: plans/001-ci-on-develop.md (verification gate)
- **Category**: bug
- **Planned at**: commit `7cbbd55`, 2026-06-11

## Why this matters

The webhook ledger dedupes deliveries by Stripe event ID. A row is created
with status `processing`, and only flipped to `processed`/`failed`/`ignored`
when the handler finishes. If the handler dies **between** those two points —
HTTP action timeout, deployment restart, Convex infrastructure interruption —
the row stays `processing` forever. Every subsequent Stripe retry then hits
the "another delivery is in flight" dedup branch and returns 200, so **the
event is permanently lost** with no error anywhere. For a billing component
this means e.g. a `checkout.session.completed` that never lands. This was a
known-open item from the 2026-06-10 audit.

## Current state

- `src/component/webhooks/mutations.ts` — the ledger mutations. The dedup
  decision is in `insertWebhookEvent` (lines 27–63):

```typescript
if (existing) {
  if (existing.status === "failed") {
    // ... reset to "processing", return "inserted" (reprocess)
  }
  // "processing" keeps deduplicating: it means another delivery of this
  // event is in flight right now, and reprocessing concurrently would
  // double-apply. If that attempt fails it marks the row "failed" and
  // the next retry takes the branch above.
  // "processed" and "ignored" are terminal — always deduplicate.
  return existing.status;
}
```

- `processedAt: Date.now()` is set on insert (line 59) and on the
  failed→processing reset (line 43), so it doubles as a "last touched"
  timestamp for an in-flight row.
- `src/component/webhooks/schema.ts` — `webhookEventsTable` has indexes
  `by_stripeEventId`, `by_status`. Fields come from
  `src/component/webhooks/validators.ts` (`webhookEventFields`).
- The handler that consumes the `"inserted"` / status return value is
  `src/client/webhooks/handler.ts` — it treats `"inserted"` as "process this
  event" and any status string as "dedupe, return 200". **No handler change
  is needed**: returning `"inserted"` for a stale row reuses the existing
  reprocessing path (same as the failed→retry flow).
- Convex constraint that makes this safe: mutations are serializable
  transactions, so the read-check-patch in `insertWebhookEvent` cannot race
  another delivery of the same event.

## Commands you will need

| Purpose   | Command                                       | Expected on success |
| --------- | --------------------------------------------- | ------------------- |
| Typecheck | `pnpm typecheck`                              | exit 0              |
| Tests     | `pnpm test`                                   | all pass            |
| Lint      | `pnpm lint`                                   | exit 0              |

## Scope

**In scope**:

- `src/component/webhooks/mutations.ts`
- `src/component/public.test.ts` or a new `src/component/webhooks/mutations.test.ts` (tests; follow the `convex-test` pattern in `src/component/triggers.test.ts`)
- `README.md` — one sentence in the "Ledger-Based Deduplication" section documenting the staleness window.

**Out of scope**:

- `src/client/webhooks/handler.ts` — the `"inserted"` contract already covers reprocessing.
- Any cron/sweeper job for stale rows — rejected approach (see Maintenance notes).
- The `failed` branch behavior — already correct, don't touch.

## Git workflow

- Branch: `advisor/003-stale-processing-ledger` off `develop`
- Conventional commits, e.g. `fix(webhooks): reprocess events stuck in processing after staleness window`
- Do NOT push, open a PR, or commit unless the operator instructed it.

## Steps

### Step 1: Add the staleness constant and branch

In `src/component/webhooks/mutations.ts`, above `insertWebhookEvent`, add:

```typescript
/**
 * How long a "processing" ledger row is trusted to be genuinely in flight.
 * Convex HTTP actions and scheduled work complete well within this window;
 * a row older than this means the original delivery died before marking the
 * event processed/failed, and the event would otherwise dedupe forever.
 * Stripe's retry schedule spans hours/days, so retries will arrive after it.
 */
const PROCESSING_STALE_MS = 10 * 60 * 1000; // 10 minutes
```

Then inside the `if (existing)` block, extend the logic so a stale
`processing` row is treated like a failed one:

```typescript
if (existing) {
  const stale =
    existing.status === "processing" &&
    Date.now() - existing.processedAt > PROCESSING_STALE_MS;

  if (existing.status === "failed" || stale) {
    // failed: prior delivery rolled back — reprocess on retry.
    // stale processing: prior delivery died without marking the row —
    // without this branch the event would deduplicate forever.
    await ctx.db.patch("webhookEvents", existing._id, {
      status: "processing",
      processedAt: Date.now(),
    });
    return "inserted" as const;
  }
  // fresh "processing": another delivery is in flight right now.
  // "processed" and "ignored" are terminal — always deduplicate.
  return existing.status;
}
```

Keep the existing comments' intent; merge them rather than deleting the
explanation of why fresh `processing` dedupes.

Note: `processedAt` is a required `v.number()` in `webhookEventFields`
(`src/component/webhooks/validators.ts`) — verified at planning time — so the
subtraction needs no null guard. If you find it optional when you execute,
that is validator drift: treat it as a STOP condition (the staleness signal
would need a schema migration, which is a different plan). Do NOT paper over
it with `?? 0`.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Document the window

In `README.md`, section "### Ledger-Based Deduplication", add one bullet:

> - **Crash recovery** -- if a delivery dies mid-processing (timeout, restart), the `processing` row goes stale after 10 minutes and the event is reprocessed on Stripe's next retry instead of deduplicating forever

**Verify**: `grep -n "Crash recovery" README.md` → one hit in the dedup section.

### Step 3: Run the suite

**Verify**: `pnpm typecheck && pnpm lint && pnpm test` → exit 0.

## Test plan

Using the `convex-test` pattern from `src/component/triggers.test.ts`
(`convexTest(schema, import.meta.glob(...))` style — copy its setup), add
tests that drive `insertWebhookEvent` directly via `t.mutation`:

1. **Fresh processing dedupes**: insert event `evt_1` (returns `"inserted"`),
   insert `evt_1` again immediately → returns `"processing"`.
2. **Stale processing reprocesses**: insert `evt_2`, then use
   `vi.useFakeTimers()` / `vi.setSystemTime` (or `vi.spyOn(Date, "now")`) to
   advance time past 10 minutes, insert `evt_2` again → returns `"inserted"`,
   and the row's `processedAt` is refreshed. Restore real timers after.
3. **Terminal statuses still dedupe regardless of age**: insert `evt_3`, mark
   it processed via `markWebhookEventProcessed`, advance time past 10 minutes,
   insert again → returns `"processed"`.
4. **Failed still reprocesses** (regression pin on existing behavior): insert
   `evt_4`, `markWebhookEventFailed`, insert again → `"inserted"`.

**Verify**: `pnpm test` → all pass including the 4 new tests.

## Done criteria

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` all exit 0
- [ ] `grep -n "PROCESSING_STALE_MS" src/component/webhooks/mutations.ts` → constant defined and used in `insertWebhookEvent`
- [ ] 4 new ledger tests exist and pass
- [ ] README dedup section documents crash recovery
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `insertWebhookEvent` no longer matches the excerpt (drift).
- `processedAt` does not exist on the webhookEvents document (validator
  drift) — the staleness signal would need a schema change, which is a
  different plan.
- Fake timers don't work under the project's vitest environment
  (`@edge-runtime/vm`) — report rather than testing with real sleeps.

## Maintenance notes

- The 10-minute constant trades duplicate-risk against loss-risk: too short
  and a slow-but-alive delivery could be double-applied by a concurrent retry;
  too long just delays recovery. 10 minutes exceeds any Convex action
  lifetime, so double-apply requires a delivery that is both dead to Convex
  and somehow still writing — not a real state.
- A periodic sweeper (cron marking stale rows `failed`) was considered and
  rejected: it adds a moving part but recovery would still wait for Stripe's
  retry, which the lazy check already achieves.
- Reviewer: confirm async hooks remain idempotent (README already requires
  this) since reprocessing re-schedules the matching `after*` hook.
