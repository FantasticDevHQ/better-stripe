# Plan 002: Make filtered list queries return complete results (fix filter-after-take)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7cbbd55..HEAD -- src/component/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (query semantics change; schema gains indexes)
- **Depends on**: plans/001-ci-on-develop.md (verification gate)
- **Category**: bug
- **Planned at**: commit `7cbbd55`, 2026-06-11

## Why this matters

Several published list queries take the first `limit` rows from an index range
and **then** filter by `status`/`active` in JavaScript. That changes the
semantics from "the first `limit` matching rows" to "the matching rows among
the first `limit` rows scanned". Once an account/user/table has more than
`limit` (default 50) rows, matching documents are silently dropped — e.g.
`listSubscriptions({ accountId, status: "active" })` can return `[]` even
though active subscriptions exist, because the 50 most recent rows in
`by_account_id` order happened to be canceled ones. Tests on small fixtures
never catch this; consumers hit it in production as data grows.

## Current state

Convex background needed: `.withIndex(...)` narrows by indexed fields;
`.take(n)` reads at most `n` documents from that range. A JS `.filter()` on
the result of `.take(n)` is the bug. The fix is compound indexes so the filter
field is part of the index range, with `.take(limit)` applied to already-
filtered rows.

The affected sites (all in `src/component/`):

1. `billing/queries.ts:47–54` — `listSubscriptions`, accountId branch:

```typescript
const subs = await ctx.db
  .query("subscriptions")
  .withIndex("by_account_id", (q) => q.eq("accountId", accountId))
  .take(limit);
if (args.status) return subs.filter((s) => s.status === args.status);
```

2. `billing/queries.ts:203–222` — `listCheckoutSessionsByUser`: `by_user_id` → `.take(limit)` → JS filter on `status`.
3. `billing/queries.ts:241–289` — `listInvoices`: four branches (accountId / userId / subscriptionId / bare), **every one** filters `status` in JS after `.take(limit)` (lines 259, 269, 281, 286).
4. `connect/queries.ts` — `listPayouts`, accountId branch: `by_account_id` → `.take(limit)` → JS filter on `status`. (The status-only branch correctly uses `by_status`.)
5. `products/queries.ts:31–57` — `listProducts`: both branches `.take(limit)` then JS filter on `active`.
6. `products/queries.ts:85–112` — `listPrices`: both branches `.take(limit)` then JS filter on `active`.

NOT affected (leave alone): `listSubscriptionsByUser`, `listSubscriptionsByOrg`,
`getActiveSubscription` — they `.collect()` the full (bounded) range before
filtering, so results are complete; they carry explicit
`eslint-disable-next-line @convex-dev/no-collect-in-query` comments.

Current index definitions (these are the complete lists — note which compound
indexes are missing):

- `billing/schema.ts`:
  - `subscriptions`: by_stripe_subscription_id, by_user_id, by_org_id, by_status, by_account_id
  - `checkoutSessions`: by_stripe_session_id, by_user_id, by_account_id
  - `invoices`: by_stripe_invoice_id, by_user_id, by_subscription_id, by_account_id
- `connect/schema.ts`:
  - `payouts`: by_stripe_payout_id, by_account_id, by_status
- `products/schema.ts`:
  - `products`: by_stripe_product_id, by_account_id
  - `prices`: by_stripe_price_id, by_product_id, by_stripe_product_id

Repo conventions: schema tables are defined as `defineTable(<fields>).index(...)`
chains in `src/component/*/schema.ts`; validators live in sibling
`validators.ts` files (do not change them — no field changes here, only
indexes). Queries use the object form with `args`/`returns` validators.

## Commands you will need

| Purpose   | Command                                   | Expected on success |
| --------- | ----------------------------------------- | ------------------- |
| Install   | `pnpm install`                            | exit 0              |
| Typecheck | `pnpm typecheck`                          | exit 0              |
| Tests     | `pnpm test`                               | all pass (325+)     |
| One file  | `pnpm test -- src/component/public.test.ts` | all pass          |
| Lint      | `pnpm lint`                               | exit 0              |

## Suggested executor toolkit

- If a `convex` skill or Convex docs access is available, consult the
  "Indexes" and "Reading data" docs to confirm compound-index query syntax:
  `q.eq("accountId", accountId).eq("status", status)`.

## Scope

**In scope** (the only files you should modify):

- `src/component/billing/schema.ts`
- `src/component/billing/queries.ts`
- `src/component/connect/schema.ts`
- `src/component/connect/queries.ts`
- `src/component/products/schema.ts`
- `src/component/products/queries.ts`
- `src/component/public.test.ts` (add tests) — if list-query tests live in a
  different existing component test file, add them there instead and note it.

**Out of scope**:

- `src/component/*/validators.ts` — no document field changes.
- `listSubscriptionsByUser` / `listSubscriptionsByOrg` / `getActiveSubscription` — already correct via `.collect()`.
- Client wrappers in `src/client/` — their signatures don't change.
- Pagination/cursor API design — explicitly deferred (see Maintenance notes).

## Git workflow

- Branch: `advisor/002-filter-after-take` off `develop`
- Conventional commits, e.g. `fix(component): filter list queries via compound indexes before take`
- Do NOT push, open a PR, or commit unless the operator instructed it.

## Steps

### Step 1: Add compound indexes

In `billing/schema.ts` add to the existing chains:

- `subscriptionsTable`: `.index("by_account_status", ["accountId", "status"])`
- `checkoutSessionsTable`: `.index("by_user_status", ["userId", "status"])`
- `invoicesTable`: `.index("by_account_status", ["accountId", "status"])`, `.index("by_user_status", ["userId", "status"])`, `.index("by_subscription_status", ["subscriptionId", "status"])`, `.index("by_status", ["status"])`

In `connect/schema.ts`:

- `payoutsTable`: `.index("by_account_status", ["accountId", "status"])`

In `products/schema.ts`:

- `productsTable`: `.index("by_account_active", ["accountId", "active"])`, `.index("by_active", ["active"])`
- `pricesTable`: `.index("by_product_active", ["productId", "active"])`, `.index("by_active", ["active"])`

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Rewrite the query handlers to select an index per arg combination

Pattern (shown for `listSubscriptions`; apply the same shape everywhere):

```typescript
handler: async (ctx, args) => {
  const limit = args.limit ?? 50;

  if (args.accountId !== undefined && args.status !== undefined) {
    const { accountId, status } = args;
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_account_status", (q) =>
        q.eq("accountId", accountId).eq("status", status),
      )
      .take(limit);
  }
  if (args.accountId !== undefined) {
    const accountId = args.accountId;
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_account_id", (q) => q.eq("accountId", accountId))
      .take(limit);
  }
  if (args.status !== undefined) {
    const status = args.status;
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_status", (q) => q.eq("status", status))
      .take(limit);
  }
  return await ctx.db.query("subscriptions").take(limit);
},
```

Apply to: `listSubscriptions`, `listCheckoutSessionsByUser` (userId is
required there, so two branches: with/without status), `listInvoices` (each of
the four existing branches gains a status-compound variant; the bare branch
with status uses the new `by_status`), `listPayouts` (accountId+status uses
`by_account_status`), `listProducts` (active is `boolean | undefined` — use
`args.active !== undefined` checks, never truthiness, because `false` is a
valid filter), `listPrices` (same boolean caution).

After this step, **no list query in these three files may contain a JS
`.filter(` call on the result of `.take(`**.

**Verify**: `grep -n "\.take(limit)" src/component/billing/queries.ts src/component/connect/queries.ts src/component/products/queries.ts` then for each hit confirm no `.filter(` within the 3 following lines: `grep -A3 "\.take(limit)" src/component/billing/queries.ts src/component/connect/queries.ts src/component/products/queries.ts | grep -c "\.filter("` → `0`.

### Step 3: Run the full suite

**Verify**: `pnpm typecheck && pnpm lint && pnpm test` → exit 0, all tests pass.

## Test plan

Add regression tests proving completeness beyond the limit, in the existing
component test file (`src/component/public.test.ts` uses `convex-test`; follow
its setup pattern — `convexTest(schema, ...)` style, same as
`src/component/triggers.test.ts`). Cases:

1. **Subscriptions**: insert 60 subscriptions for one accountId — first 55
   with status `canceled`, last 5 with status `active`. Call
   `listSubscriptions({ accountId, status: "active" })`. Expect exactly 5
   results. (Against the old code this returns 0 — confirm the test fails if
   you temporarily revert Step 2, then re-apply.)
2. **Invoices**: same shape for the userId branch (60 invoices, 5 `paid` at the
   end, query `{ userId, status: "paid" }` → 5).
3. **Products**: 60 products for one accountId, 5 with `active: false` at the
   end, query `{ accountId, active: false }` → 5. This also pins the
   `false`-is-a-valid-filter behavior.
4. **Limit still respected**: 60 active subscriptions, query
   `{ accountId, status: "active", limit: 10 }` → exactly 10.

**Verify**: `pnpm test` → all pass including the 4 new tests.

## Done criteria

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` all exit 0
- [ ] The grep in Step 2's verify returns 0 filter-after-take occurrences
- [ ] 4 new regression tests exist and pass
- [ ] `listSubscriptionsByUser` / `ByOrg` / `getActiveSubscription` are untouched (`git diff` shows no hunks in them)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The query handlers no longer match the excerpts (drift).
- `convex-test` rejects the new compound indexes or the test harness can't
  load the modified schema — report the exact error.
- Any *existing* test fails after Step 2 — that means some caller depends on
  the old (incomplete) semantics; report which test, do not "fix" it.
- You find additional filter-after-take sites outside the six listed —
  report them; do not expand scope silently.

## Maintenance notes

- Future pagination work (cursor-based `listX` APIs) should build on these
  compound indexes; do not reintroduce JS post-filtering.
- Reviewer should scrutinize the `args.active !== undefined` checks — a
  truthiness check would silently break the `active: false` filter.
- Index count per table is still far below Convex's limit (32).
- Deferred: the same audit noted the queries return raw arrays with no
  `hasMore` signal; adding cursor pagination is a separate design decision.
