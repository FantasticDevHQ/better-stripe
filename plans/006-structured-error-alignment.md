# Plan 006: Align remaining raw throws on structured BetterStripeError

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7cbbd55..HEAD -- src/client/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW–MED (error shapes change for 4 call sites; consumers may match on messages)
- **Depends on**: plans/001-ci-on-develop.md. No hard ordering vs
  plans/005-tests-for-untested-money-methods.md — either order works because
  this plan keeps error message substrings verbatim (see Step 2); if 005 has
  already run, its tests double as regression checks here.
- **Category**: tech-debt
- **Planned at**: commit `7cbbd55`, 2026-06-11

## Why this matters

The README promises structured errors ("Structured errors are thrown as
`ConvexError` with a `BetterStripeError` payload") but admits in a note that
"error semantics are not yet uniform across the API" and that aligning them
"is planned". This plan is that alignment. Today a consumer writing
`catch (e) { if (isBetterStripeError(e)) ... }` gets structured errors from
newer methods (`createAccountSession`, `createAccountLink`) but raw
`Error`/Stripe SDK errors from four other sites. For a published package this
inconsistency forces every consumer to handle both shapes everywhere. Doing
this before first publish (Plan 009) avoids it ever being a breaking change.

## Current state

Error machinery (already exists, use it):

- `src/client/errors.ts` — `throwStripeError(code, message, stripeError?)`
  builds a `BetterStripeError` and throws `new ConvexError(errorData as unknown as string)`
  (line 48 — note the double cast, addressed in Step 4). `isBetterStripeError`
  type guard at lines 54–62. `BetterStripeErrorCode` union lives in
  `src/client/types.ts` or `src/client/types/` (grep `BetterStripeErrorCode`)
  and is documented in README's Error Handling section.
- Exemplar of the target pattern: `src/client/core/accountLinks.ts:97` calls
  `throwStripeError(...)` inside a catch. Match it.

The four raw-throw sites to convert (complete inventory as of `7cbbd55`,
found via `grep -n "throw " src/client/**/*.ts` excluding tests and
`throwStripeError` lines):

1. `src/client/core/accounts.ts:135–147` — `createAccountWithOnboarding`:
   after best-effort rollback of the half-created account, line 147 rethrows
   the raw SDK error:

```typescript
} catch (configError) {
  // Roll back: delete the half-created account from Convex so retries
  // don't get stuck on an unusable pending account
  try {
    await runMutationOrThrow(...);
  } catch {
    // Best effort cleanup
  }
  throw configError;
}
```

2. `src/client/billing/subscriptions.ts:71` — `updateSubscriptionQuantity`:
   `if (!itemId) throw new Error("Subscription has no items");`

3. `src/client/products/prices.ts:49–52` — `createPrice`:
   `throw new Error(\`Product ${opts.stripeProductId} not found in component DB when creating price\`);`

4. `src/client/connect/paymentMethods.ts:53–57` — `setDefaultPaymentMethod`:
   the intentional not-implemented throw (raw `Error` today).

## Commands you will need

| Purpose   | Command          | Expected on success |
| --------- | ---------------- | ------------------- |
| Typecheck | `pnpm typecheck` | exit 0              |
| Tests     | `pnpm test`      | all pass            |
| Lint      | `pnpm lint`      | exit 0              |

## Scope

**In scope**:

- `src/client/core/accounts.ts` (site 1)
- `src/client/billing/subscriptions.ts` (site 2)
- `src/client/products/prices.ts` (site 3)
- `src/client/connect/paymentMethods.ts` (site 4)
- `src/client/errors.ts` (Step 4 cast cleanup only)
- The file defining `BetterStripeErrorCode` (add one code, Step 1)
- `README.md` Error Handling section (error-code list + remove/soften the "not yet uniform" note)
- `src/client/index.test.ts` and/or `src/client/errors.test.ts` (test updates)

**Out of scope**:

- Wrapping every Stripe SDK call in the codebase in try/catch — methods that
  let SDK errors propagate *uncaught* (no catch block at all) are a separate
  policy decision; this plan only converts sites that already throw their own
  errors or already catch-and-rethrow.
- `WEBHOOK_INVALID_DATA` for dispatcher guards (separate known-backlog item;
  see Maintenance notes).
- The webhook handler's HTTP error responses.

## Git workflow

- Branch: `advisor/006-structured-errors` off `develop`
- Conventional commits, e.g. `fix(client): structured BetterStripeError from remaining raw-throw sites`
- Do NOT push, open a PR, or commit unless the operator instructed it.

## Steps

### Step 1: Add the missing error code

Find the `BetterStripeErrorCode` union (`grep -rn "BetterStripeErrorCode" src/client/`).
Add `"SUBSCRIPTION_UPDATE_FAILED"` to it, keeping the existing ordering style.
Add the code to the README's error-code list in the same sentence position.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Convert the four sites

Import `throwStripeError` from the relative `../errors.js` path (match the
existing import in `src/client/core/accountLinks.ts:3`, adjusting depth).

1. `accounts.ts:147` →
   `throwStripeError("ACCOUNT_CREATE_FAILED", "Failed to apply account configuration after create; account was rolled back", configError);`
2. `subscriptions.ts:71` →
   `throwStripeError("SUBSCRIPTION_UPDATE_FAILED", "Subscription has no items");`
3. `prices.ts:49` →
   `throwStripeError("PRODUCT_NOT_FOUND", \`Product ${opts.stripeProductId} not found in component DB when creating price\`);`
4. `paymentMethods.ts:53` →
   `throwStripeError("PAYMENT_METHOD_FAILED", "[better-stripe] setDefaultPaymentMethod is not yet implemented for V2 Accounts. Use createBillingPortalSession() to let users manage payment methods.");`

Keep messages verbatim where given — if Plan 005 has already run, its tests
match on these substrings (`"Subscription has no items"`,
`"not yet implemented for V2 Accounts"`); keeping the strings verbatim makes
this plan correct in either execution order.

**Verify**: `grep -rn "throw new Error\|throw configError" src/client/core/accounts.ts src/client/billing/subscriptions.ts src/client/products/prices.ts src/client/connect/paymentMethods.ts` → 0 hits.

### Step 3: Update tests that assert the old shapes

Run `pnpm test`. Any test asserting `toThrow("Subscription has no items")`
etc. should still pass (`ConvexError` messages include the payload), but if a
test asserts `instanceof Error` semantics that changed, update it to use
`isBetterStripeError` + code assertions instead. Add one new test per
converted site asserting `isBetterStripeError(e)` is true and `e.data.code`
is the expected code (pattern: existing tests in `src/client/errors.test.ts`).

**Verify**: `pnpm test` → all pass, including 4 new code-assertion tests.

### Step 4: Attempt the cast cleanup in errors.ts

`src/client/errors.ts:48` reads
`throw new ConvexError(errorData as unknown as string);`.
Try `throw new ConvexError(errorData);`. Convex's `ConvexError<T extends Value>`
generally accepts plain serializable objects; the double cast is likely
historical. If `pnpm typecheck` passes, keep the clean version. **If it fails,
revert to the cast and add a one-line comment stating the convex version's
constructor typing forces it** — do not restructure `BetterStripeError` to
satisfy it.

**Verify**: `pnpm typecheck` → exit 0 either way.

## Test plan

- 4 new tests (one per converted site) asserting structured payloads — see Step 3.
- Existing `errors.test.ts` continues to pass unchanged.
- Verification: `pnpm test` → all pass.

## Done criteria

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` all exit 0
- [ ] Step 2's grep returns 0 raw throws at the four sites
- [ ] `SUBSCRIPTION_UPDATE_FAILED` exists in the code union AND the README list
- [ ] README's "error semantics are not yet uniform" note is updated to reflect the new state (uniform for thrown component errors; uncaught SDK propagation documented as-is)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The raw-throw inventory doesn't match — extra `throw new Error` sites exist
  in `src/client/` beyond the four listed (report them; don't silently expand).
- Plan 005's tests already exist and changing site 4's error shape breaks its
  `setDefaultPaymentMethod` test in a way substring-matching can't fix —
  coordinate, don't weaken the test. (If Plan 005 hasn't run yet, this
  condition cannot trigger.)
- The Step 4 typecheck failure mode is anything other than the ConvexError
  constructor parameter type.

## Maintenance notes

- Still deferred from the audit backlog: a `WEBHOOK_INVALID_DATA` error code
  for trigger-dispatcher payload guards (`src/client/webhooks/hooks.ts` /
  dispatcher construction) — smaller, separate change.
- Policy question for the maintainer (not this plan): should methods that
  currently let Stripe SDK errors propagate uncaught (most action wrappers)
  catch-and-wrap with `STRIPE_API_ERROR`? That's a sweeping behavioral change
  best decided before 1.0.
- Reviewer: confirm no consumer-visible message strings were altered beyond
  wrapping (the example app may render them).
