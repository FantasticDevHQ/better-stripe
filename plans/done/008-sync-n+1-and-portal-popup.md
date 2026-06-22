# Plan 008: Fix syncAllProducts N+1 and BillingPortalLink popup blocking

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7cbbd55..HEAD -- src/client/products/products.ts src/react/components/BillingPortalLink.tsx`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf / bug
- **Planned at**: commit `7cbbd55`, 2026-06-11

## Why this matters

Two small, unrelated fixes bundled by size. (a) `syncAllProducts` runs one
Convex query per Stripe **price** to resolve its parent product — a catalog
with 1,000 products × 5 prices issues 5,000+ action→component round trips
during an admin sync that needs at most one lookup per *distinct product*.
(b) `BillingPortalLink`'s default behavior calls `window.open` **after** an
`await`, which Safari and Firefox popup blockers kill because the call is no
longer inside the user-gesture call stack — users click "Manage billing" and
nothing happens. This was a known-open item from the 2026-06-10 audit.

## Current state

### (a) `src/client/products/products.ts:200–216` — the price loop

```typescript
for await (const price of stripe.prices.list({ limit: 100 })) {
  try {
    const stripeProductId =
      typeof price.product === "string" ? price.product : "";

    const internalProduct = await ctx.runQuery(
      componentRef(component, "products/queries/getProductByStripeId"),
      { stripeProductId },
    );

    if (!internalProduct) {
      console.warn(...); continue;
    }
    await runMutationOrThrow(... "products/mutations/upsertPrice" ...,
      { ..., productId: internalProduct._id, ... });
```

### (b) `src/react/components/BillingPortalLink.tsx:37–58` — the click handler

```typescript
const handleClick = async () => {
  if (portalUrl) {
    window.open(portalUrl, "_blank");        // line 39 — synchronous, fine
    return;
  }
  if (onCreateSession && !isLoading) {
    setIsLoading(true);
    try {
      const url = await onCreateSession();
      if (url) {
        window.open(url, "_blank");          // line 47 — AFTER await: blocked
      }
    } catch (err) { ... onError?.(message); } finally { setIsLoading(false); }
  }
};
```

Repo conventions: React components are headless, client-directive files
(`"use client"`), errors surfaced via `onError` callback + console.error with
a `[better-stripe]` prefix. React component tests in this repo are
`.test.ts` files exercising logic/exports (vitest under `@edge-runtime/vm`,
no DOM) — see `src/react/components/EmbeddedCheckout.test.ts`.

## Commands you will need

| Purpose   | Command          | Expected on success |
| --------- | ---------------- | ------------------- |
| Typecheck | `pnpm typecheck` | exit 0              |
| Tests     | `pnpm test`      | all pass            |
| Lint      | `pnpm lint`      | exit 0              |

## Scope

**In scope**:

- `src/client/products/products.ts` (fix a)
- `src/react/components/BillingPortalLink.tsx` (fix b)
- `src/client/index.test.ts` or a products test location (test for fix a, if the sync function is reachable through the existing mock harness)

**Out of scope**:

- `syncAllAccounts` / `syncAllSubscriptions` — no per-item component queries there.
- The render-prop (`children`) path of BillingPortalLink — consumers own
  their click handling.
- `AddCardForm` and other components.

## Git workflow

- Branch: `advisor/008-sync-n+1-portal-popup` off `develop`
- Conventional commits, one per fix: `perf(client): memoize product lookups in syncAllProducts`, `fix(react): open billing portal synchronously to survive popup blockers`
- Do NOT push, open a PR, or commit unless the operator instructed it.

## Steps

### Step 1: Memoize the product lookup in `syncAllProducts`

Before the price loop, add a cache; inside the loop, consult it:

```typescript
const productCache = new Map<
  string,
  { _id: string } | null
>();
// in the loop, replacing the direct ctx.runQuery call:
let internalProduct = productCache.get(stripeProductId);
if (internalProduct === undefined) {
  internalProduct = (await ctx.runQuery(
    componentRef(component, "products/queries/getProductByStripeId"),
    { stripeProductId },
  )) as { _id: string } | null;
  productCache.set(stripeProductId, internalProduct);
}
```

Match the surrounding typing style (the existing code casts the query result —
mirror whatever cast/type the live code uses). `null` results are cached too,
so a missing product warns once per product, not once per price; keep the
existing `console.warn` + `continue` behavior.

**Verify**: `pnpm typecheck` → exit 0; `grep -n "productCache" src/client/products/products.ts` → cache declared outside the loop, consulted inside.

### Step 2: Open the portal window before the await

Rewrite the `onCreateSession` branch of `handleClick` using the
open-then-navigate pattern:

```typescript
if (onCreateSession && !isLoading) {
  // Open synchronously inside the user gesture so popup blockers allow it;
  // navigate it once the session URL arrives.
  const portalWindow = window.open("", "_blank");
  setIsLoading(true);
  try {
    const url = await onCreateSession();
    if (url) {
      if (portalWindow) {
        portalWindow.location.href = url;
      } else {
        // Popup was blocked anyway — fall back to same-tab navigation.
        window.location.href = url;
      }
    } else {
      portalWindow?.close();
    }
  } catch (err) {
    portalWindow?.close();
    const message =
      err instanceof Error ? err.message : "Failed to open billing portal";
    console.error("[better-stripe] BillingPortalLink:", err);
    onError?.(message);
  } finally {
    setIsLoading(false);
  }
}
```

Keep the `portalUrl` fast path (line 38–41) unchanged. Keep prop types and
the render-prop contract unchanged.

**Verify**: `pnpm typecheck && pnpm lint` → exit 0.

### Step 3: Tests + full suite

For fix (a): if `syncAllProducts` is exposed on the `BetterStripe` facade and
reachable via the `index.test.ts` mock harness (mock `stripe.products.list` /
`stripe.prices.list` as async iterables), add a test: 1 product, 3 prices
sharing it → assert `ctx.runQuery` for `getProductByStripeId` was called
exactly once. If the async-iterable mocking fights the existing harness for
more than ~30 minutes, record the test as deferred in your report instead of
forcing it (the change is mechanically verifiable by the grep in Step 1).

For fix (b): no DOM in this test environment — do not write a jsdom test.
The existing `src/react/index.test.ts` export checks must still pass.

**Verify**: `pnpm test` → all pass.

## Test plan

See Step 3 — one cache-behavior test for (a) if the harness allows; existing
suite green is the gate for (b). Manual check available to the operator: in
the example app's billing page, click "Manage billing" in Safari with default
popup settings — the portal tab must open.

## Done criteria

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` all exit 0
- [ ] `getProductByStripeId` query is consulted via cache in `syncAllProducts` (Step 1 grep)
- [ ] No `window.open` call after an `await` remains in `BillingPortalLink.tsx` (read the diff)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Either file no longer matches its excerpt (drift).
- The example app or any test depends on `BillingPortalLink` returning before
  opening (unlikely; report if a test asserts `window.open` call ordering).

## Maintenance notes

- The open-then-navigate pattern shows a brief blank tab while the session is
  created — expected trade-off; an alternative (render an `<a href>` once the
  URL is prefetched) would change the component contract and was not chosen.
- If checkout/redirect flows elsewhere ever add an open-after-await, apply
  the same pattern (`grep -rn "window.open" src/react/` to audit).
- Reviewer: confirm the `null`-cache in fix (a) — a product genuinely created
  mid-sync would stay "missing" for that run; acceptable, it syncs next run.
