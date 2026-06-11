# Plan 004: Stop empty-string userId from matching user-scoped queries

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7cbbd55..HEAD -- src/component/billing/queries.ts src/client/webhooks/helpers.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/002-fix-filter-after-take-queries.md (touches the same queries file; execute after it to avoid conflicts)
- **Category**: bug
- **Planned at**: commit `7cbbd55`, 2026-06-11

## Why this matters

Webhook events whose Stripe metadata lacks a `userId` are stored with
`userId: ""` (the component's "unattributed" sentinel — the field is a
required `v.string()` in every domain validator). That part is by design. The
bug is that nothing guards the *query* side: a consumer who calls
`getActiveSubscription({ userId: someUser.id })` where `someUser.id` is
accidentally `""`/unset gets back **another customer's unattributed
subscription** instead of `null`. Same for `listSubscriptionsByUser`,
`listCheckoutSessionsByUser`, and the `userId` branch of `listInvoices`. In a
billing component this is a correctness and data-exposure hazard: empty input
should never match anything.

## Current state

- The sentinel originates in `src/client/webhooks/helpers.ts:101–108`:

```typescript
export function extractIdentifiers(
  metadata: Record<string, string> | null | undefined,
): { userId: string; orgId: string | undefined } {
  return {
    userId: metadata?.userId ?? metadata?.user_id ?? "",
    orgId: metadata?.orgId ?? metadata?.org_id ?? undefined,
  };
}
```

and again (duplicated inline) in `src/client/billing/subscriptions.ts:213`
inside `syncAllSubscriptions`:

```typescript
const userId = metadata.userId ?? metadata.user_id ?? "";
```

Note `orgId` correctly uses `undefined` — only `userId` produces `""` rows,
because `userId` is required in the validators
(`src/component/billing/validators.ts:39,68,102`,
`src/component/connect/validators.ts:28`). **Do not change the validators or
the sentinel** — making `userId` optional is a schema migration deferred out
of this plan.

- The unguarded user-scoped queries, all in `src/component/billing/queries.ts`:
  - `listSubscriptionsByUser` (lines 72–91) — `by_user_id` index, `q.eq("userId", args.userId)`
  - `listSubscriptionsByOrg` (lines 93–112) — orgId variant (orgId is never stored as `""`, but an explicit guard is still correct defense)
  - `getActiveSubscription` (lines 114–138) — the dangerous one: returns a single doc
  - `listCheckoutSessionsByUser` (lines 203–222)
  - `listInvoices` userId branch (lines 263–271)

Repo conventions: queries use object form with `args`/`returns` validators;
early returns are idiomatic in these handlers.

## Commands you will need

| Purpose   | Command          | Expected on success |
| --------- | ---------------- | ------------------- |
| Typecheck | `pnpm typecheck` | exit 0              |
| Tests     | `pnpm test`      | all pass            |
| Lint      | `pnpm lint`      | exit 0              |

## Scope

**In scope**:

- `src/component/billing/queries.ts` (guards)
- `src/client/webhooks/helpers.ts` (doc comment only — see Step 2)
- `src/component/public.test.ts` (or wherever Plan 002 put the list-query tests) — new tests
- `README.md` — one sentence documenting the unattributed sentinel (App-Layer Tables or Webhook Event Processing section, executor's judgment on placement)

**Out of scope**:

- `src/component/*/validators.ts` — no schema/optionality change (deferred).
- The webhook processors and `syncAllSubscriptions` — they keep writing `""` for unattributed records; that is the documented sentinel.
- `connect/queries.ts` — no user-scoped query exists there today.

## Git workflow

- Branch: `advisor/004-empty-userid-guards` off `develop`
- Conventional commits, e.g. `fix(component): empty userId/orgId never matches user-scoped queries`
- Do NOT push, open a PR, or commit unless the operator instructed it.

## Steps

### Step 1: Add guards to the five queries

At the top of each listed handler in `src/component/billing/queries.ts`:

- `listSubscriptionsByUser`, `listCheckoutSessionsByUser`: `if (args.userId === "") return [];`
- `listSubscriptionsByOrg`: `if (args.orgId === "") return [];`
- `getActiveSubscription`: add, **in this order**, at the top of the handler:

  ```typescript
  // Empty orgId is treated as absent.
  const orgId = args.orgId === "" ? undefined : args.orgId;
  if (args.userId === "" && orgId === undefined) return null;
  ```

  then use the local `orgId` (not `args.orgId`) in the existing branch.
  Rationale for the compound condition: when a real `orgId` is provided the
  handler queries `by_org_id` and ignores `userId` entirely, so
  `userId: ""` with a valid orgId is a legitimate org-scoped lookup and must
  NOT return null. The guard only fires when BOTH identifiers are
  empty/absent — the case that would otherwise match unattributed `""` rows.
- `listInvoices`: in the userId branch, change the condition `if (args.userId)` — it already skips `""` because empty string is falsy. **Verify this is true in the live code and leave it; add a test instead of a code change.**

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Document the sentinel where it's created

Extend the doc comment on `extractIdentifiers` in
`src/client/webhooks/helpers.ts` (and the inline site in
`syncAllSubscriptions`) with one line:

```
Returns userId "" when the Stripe object has no userId metadata (e.g. created
in the Stripe Dashboard). "" rows are stored but never matched by user-scoped
queries.
```

**Verify**: `grep -n 'never matched' src/client/webhooks/helpers.ts` → 1 hit.

### Step 3: README note + full suite

Add one sentence to README (Event Processing or Ledger section):
records synced from Stripe objects without `userId` metadata are stored
unattributed (`userId: ""`) and are not returned by user-scoped queries.

**Verify**: `pnpm typecheck && pnpm lint && pnpm test` → exit 0.

## Test plan

In the component test file (same harness as Plan 002's tests — `convex-test`,
pattern: `src/component/triggers.test.ts`):

1. Insert a subscription with `userId: ""`, status `active`. Call
   `getActiveSubscription({ userId: "" })` → expect `null` (this fails before
   the fix — confirm by running the test against unmodified code first).
2. `listSubscriptionsByUser({ userId: "" })` → `[]` even though a `""` row exists.
3. `listSubscriptionsByUser({ userId: "user_1" })` with both a `user_1` row and
   a `""` row present → returns only the `user_1` row (pins that legitimate
   lookups are unaffected).
4. `listInvoices({ userId: "" })` → falls through to the unfiltered branch
   (documents current falsy-skip behavior; assert it does NOT return only
   `""`-attributed invoices as if matching).

**Verify**: `pnpm test` → all pass including the new tests.

## Done criteria

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` all exit 0
- [ ] New tests from the test plan exist and pass
- [ ] `getActiveSubscription({ userId: "" })` provably returns null (test 1)
- [ ] No validator/schema files modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The queries file doesn't match the excerpts (drift — especially if Plan 002
  restructured branches differently than its plan specified).
- Any existing test asserts that `""` userId queries DO return rows — that
  would mean a consumer depends on the sentinel matching; report it.
- You're tempted to make `userId` optional in the validators — that's the
  deferred migration, not this plan.

## Maintenance notes

- The real long-term fix is making `userId` optional in the four validators
  and storing `undefined` instead of `""` (deferred: it ripples through
  validators, generated types, client types, and is a breaking schema change
  while rows with `""` already exist). If that migration happens, these guards
  become dead code and should be removed with it.
- Reviewer: check that no new query added since this plan reintroduces an
  unguarded `q.eq("userId", ...)` with caller-supplied input.
