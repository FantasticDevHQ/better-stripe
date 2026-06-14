# Plan 005: Unit tests for the untested money-touching client methods

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7cbbd55..HEAD -- src/client/billing/subscriptions.ts src/client/connect/paymentMethods.ts src/client/connect/payouts.ts src/client/index.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (test-only; no production code changes)
- **Depends on**: none (independent of plans 002–004)
- **Category**: tests
- **Planned at**: commit `7cbbd55`, 2026-06-11

## Why this matters

The webhook pipeline is well tested (1,600+ lines in
`src/client/webhooks.test.ts`) and `cancelSubscription`/`reactivateSubscription`
have unit tests, but five methods that move money or payment instruments have
**zero** test references: `updateSubscriptionQuantity`, `attachPaymentMethod`,
`detachPaymentMethod`, `listPaymentMethods`, and `createPayout`. A regression
in, say, which Stripe param `listPaymentMethods` passes (`customer_account`
vs `customer` — a V2-specific choice) or whether `createPayout` sends the
`stripeAccount` header would ship silently. These are exactly the calls where
a wrong parameter means money goes to the wrong place. The repo owner has an
explicit standing preference: tests for everything.

## Current state

All five functions are thin Stripe-SDK wrappers, called via the
`BetterStripe` class facade in `src/client/index.ts`.

- `src/client/billing/subscriptions.ts:64–74`:

```typescript
export async function updateSubscriptionQuantity(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: { stripeSubscriptionId: string; quantity: number },
) {
  const sub = await stripe.subscriptions.retrieve(opts.stripeSubscriptionId);
  const itemId = sub.items?.data?.[0]?.id;
  if (!itemId) throw new Error("Subscription has no items");
  await stripe.subscriptionItems.update(itemId, { quantity: opts.quantity });
  return { success: true };
}
```

- `src/client/connect/paymentMethods.ts` — `listPaymentMethods` passes
  `{ customer_account: opts.stripeCustomerId, type: opts.type ?? "card" }`;
  `attachPaymentMethod` calls `stripe.paymentMethods.attach(id, { customer_account })`;
  `detachPaymentMethod` calls `stripe.paymentMethods.detach(id)`;
  `setDefaultPaymentMethod` intentionally throws
  `"[better-stripe] setDefaultPaymentMethod is not yet implemented for V2 Accounts. ..."`.
- `src/client/connect/payouts.ts:11–30` — `createPayout` calls
  `stripe.payouts.create({ amount, currency: opts.currency ?? "usd", metadata }, { stripeAccount: opts.stripeAccountId })`
  and returns `{ stripePayoutId: payout.id }`.

The test pattern to copy: `src/client/index.test.ts` — it constructs
`new BetterStripe(components.betterStripe, { STRIPE_SECRET_KEY: "sk_test_xxx" })`
against a module-level `mockStripeInstance` (a mocked stripe SDK) and a
`mockCtx`. See the `describe("cancelSubscription", ...)` block at
`src/client/index.test.ts:339–377` for the exact shape:

```typescript
describe("cancelSubscription", () => {
  it("uses update with cancel_at_period_end when atPeriodEnd", async () => {
    const bs = new BetterStripe(components.betterStripe, {
      STRIPE_SECRET_KEY: "sk_test_xxx",
    });
    mockStripeInstance.subscriptions.update.mockResolvedValue({});
    await bs.cancelSubscription(mockCtx, {
      stripeSubscriptionId: "sub_123",
      cancelAtPeriodEnd: true,
    });
    expect(mockStripeInstance.subscriptions.update).toHaveBeenCalledWith(
      "sub_123",
      { cancel_at_period_end: true },
    );
    ...
```

Inspect the top of `index.test.ts` for how `mockStripeInstance` is declared —
you will likely need to add `subscriptionItems`, `paymentMethods`, and
`payouts` namespaces to the mock object if absent.

## Commands you will need

| Purpose          | Command                                  | Expected on success |
| ---------------- | ---------------------------------------- | ------------------- |
| Just these tests | `pnpm test -- src/client/index.test.ts`  | all pass            |
| Full suite       | `pnpm test`                              | all pass            |
| Typecheck        | `pnpm typecheck`                         | exit 0              |
| Lint             | `pnpm lint`                              | exit 0              |

## Scope

**In scope**:

- `src/client/index.test.ts` (add describes; extend the stripe mock object as needed)

**Out of scope**:

- ANY production source file. If a test reveals a real bug, STOP and report —
  do not fix production code in this plan.
- E2E harness (`example/scripts/e2e-webhooks.ts`).

## Git workflow

- Branch: `advisor/005-money-method-tests` off `develop`
- Conventional commits, e.g. `test(client): cover subscription quantity, payment method, and payout methods`
- Do NOT push, open a PR, or commit unless the operator instructed it.

## Steps

### Step 1: Extend the stripe mock

Add (if missing) to `mockStripeInstance` in `index.test.ts`:
`subscriptions.retrieve`, `subscriptionItems.update`, `paymentMethods.list`,
`paymentMethods.attach`, `paymentMethods.detach`, `payouts.create` — all as
`vi.fn()`, matching how the existing namespaces are declared.

**Verify**: `pnpm test -- src/client/index.test.ts` → existing tests still pass.

### Step 2: Add the describes

Following the `cancelSubscription` pattern, add:

1. `describe("updateSubscriptionQuantity")`
   - happy path: `subscriptions.retrieve` resolves `{ items: { data: [{ id: "si_1" }] } }`;
     assert `subscriptionItems.update` called with `("si_1", { quantity: 3 })`
     and the method resolves `{ success: true }`.
   - no items: retrieve resolves `{ items: { data: [] } }`; assert it rejects
     with message containing `"Subscription has no items"` and
     `subscriptionItems.update` was NOT called.
2. `describe("listPaymentMethods")`
   - default type: assert `paymentMethods.list` called with
     `{ customer_account: "acct_1", type: "card" }` — this pins the
     V2 `customer_account` (not `customer`) parameter.
   - explicit type passes through.
3. `describe("attachPaymentMethod")` — assert
   `paymentMethods.attach("pm_1", { customer_account: "acct_1" })` and
   `{ success: true }` return.
4. `describe("detachPaymentMethod")` — assert `paymentMethods.detach("pm_1")`.
5. `describe("setDefaultPaymentMethod")` — assert it rejects with a message
   containing `"not yet implemented for V2 Accounts"` (pins the intentional
   stub so a future silent "implementation" can't slip through unreviewed).
6. `describe("createPayout")`
   - assert `payouts.create` called with
     (`{ amount: 5000, currency: "usd", metadata: undefined }`,
     `{ stripeAccount: "acct_1" }`) — the second argument is the critical
     Connect routing header.
   - currency override passes through; returns `{ stripePayoutId }` from the
     mock's resolved `{ id: "po_1" }`.

Check the exact public method names/signatures on the `BetterStripe` class in
`src/client/index.ts` before writing calls (e.g. the facade may take
`{ stripeCustomerId }` — mirror the facade, not the inner function).

**Verify**: `pnpm test -- src/client/index.test.ts` → all pass, including ~10 new tests.

### Step 3: Full suite + lint

**Verify**: `pnpm typecheck && pnpm lint && pnpm test` → exit 0.

## Test plan

This plan IS the test plan — see Step 2 for the case list. Structural
pattern: `src/client/index.test.ts:339–377`.

## Done criteria

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` all exit 0
- [ ] All six new describes exist — this loop prints nothing:
  `for n in updateSubscriptionQuantity listPaymentMethods attachPaymentMethod detachPaymentMethod setDefaultPaymentMethod createPayout; do grep -q "describe(\"$n\"" src/client/index.test.ts || echo "MISSING $n"; done`
- [ ] No production source files modified (`git status` shows only `index.test.ts`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- A test you write fails against the *current* production code — that's a
  real bug discovery, not a test bug. Report which method and the observed
  vs expected call.
- The mock architecture in `index.test.ts` doesn't allow adding namespaces
  without restructuring (e.g. the stripe mock is frozen or built differently
  than described) — report instead of restructuring the whole file.

## Maintenance notes

- When `setDefaultPaymentMethod` is eventually implemented for V2, test 5
  must be replaced with real behavior tests — it's a tripwire, not a contract.
- If Plan 011 (refunds/disputes) or Plan 010 (subscription write surface)
  lands, the same pattern applies to every new money-touching method.
