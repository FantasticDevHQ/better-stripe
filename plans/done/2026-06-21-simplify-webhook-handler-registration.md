# Simplify Webhook Handler Registration — Implementation Plan

> **STATUS (2026-06-22): COMPLETE.** Tasks 1–6 shipped on `develop` (typecheck +
> lint + 357 tests green; example pushes cleanly via `convex dev --once`;
> `triggersApi()` fully removed; README reflects the 2-export API). **Not yet
> released** — these changes are unpublished; they ship in the next version bump.
> Task 7 (migrate dojo) is intentionally out of scope for this repo and tracked
> as a sequenced follow-up in `plans/README.md` (do it after the release that
> includes this change).

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the 18-export `triggersApi()` registration boilerplate with a single `stripe.webhookHandlers()` returning a `{ syncWebhook, asyncWebhook }` pair, wired via `registerRoutes(..., { webhooks: internal.stripe })`.

**Architecture:** Keep the existing `triggers` (domain-nested sync) + `hooks` (flat async) definitions on the `BetterStripe` constructor unchanged. Collapse the 9 sync dispatcher mutations + 9 async hook actions into **two** generated functions that route internally by a discriminator arg: `syncWebhook(dispatcher, data)` (internalMutation) and `asyncWebhook(hook, doc)` (internalAction). The webhook handler's two consumption points (`dispatchUpsert`, `scheduleAsyncHook`) call these two refs instead of indexing 18. Clean cutover — `triggersApi()` is removed.

**Tech Stack:** TypeScript, Convex 1.41 (`internalMutationGeneric`/`internalActionGeneric`), vitest + convex-test.

**Design doc:** `plans/2026-06-17-trigger-hook-registration-design.md` (Option A, clean cutover).

**Decisions:** Keep `triggers`/`hooks` shape. Remove `triggersApi()` entirely (breaking, pre-1.0). Migrate example app in this change; dojo migrates after better-stripe publishes (see Task 7).

---

## Key current-state references (verified)

- `triggersApi()` — `src/client/index.ts:1019-1282`. Builds 9 sync dispatchers (`createUpsertDispatcher` / special-cased `subscriptionDeleted`) + 9 async hooks (`createAsyncHook`).
- Sync consumption — `src/client/webhooks/helpers.ts:221` `dispatchUpsert(whCtx, dispatcherName, data)` → `whCtx.config?.triggers?.[dispatcherName]` → `runMutation(ref, { data })`; fallback `componentRef(component, DISPATCHER_UPSERT_PATHS[name])`.
- Async consumption — `src/client/webhooks/hooks.ts:119` `scheduleAsyncHook` → `whCtx.config?.triggers?.[spec.hook]` → `scheduler.runAfter(0, ref, { doc })`.
- Config type — `src/client/types/options.ts:24` `RegisterRoutesConfig` has `triggers?: TriggerApiRefs` (line 40). Constructor type `BetterStripeOptions.triggers: SyncTriggers` (line 15) + `hooks: AsyncHooks` — UNCHANGED.
- Names/paths — `DISPATCHER_UPSERT_PATHS` (`helpers.ts:204`), `TriggerDispatcherName` / `AsyncHookName` (`types/triggers.ts`).

---

## Task 1: Add `WebhookHandlerRefs` type

**Files:**
- Modify: `src/client/types/triggers.ts` (add type near `TriggerApiRefs`)

**Step 1:** Add the new ref type (two functions, discriminated args):

```ts
import type { FunctionReference } from "convex/server";

/** The two function refs produced by `stripe.webhookHandlers()`. */
export type WebhookHandlerRefs = {
  syncWebhook: FunctionReference<
    "mutation",
    "internal",
    { dispatcher: TriggerDispatcherName; data: Record<string, unknown> },
    null
  >;
  asyncWebhook: FunctionReference<
    "action",
    "internal",
    { hook: AsyncHookName; doc: Record<string, unknown> },
    null
  >;
};
```

**Step 2:** `pnpm typecheck:lib` → PASS (type-only, no usage yet).

**Step 3:** Commit: `git commit -m "feat(webhooks): add WebhookHandlerRefs type"`

---

## Task 2: Add `BetterStripe.webhookHandlers()` returning the routing pair

**Files:**
- Modify: `src/client/index.ts` (add method; reuse the existing dispatcher/hook builders extracted from `triggersApi()`)
- Test: `src/client/index.test.ts` (or a new `src/client/webhook-handlers.test.ts`)

**Approach:** Refactor the per-dispatcher specs from `triggersApi()` into a `Record<TriggerDispatcherName, DispatcherSpec>` and a `Record<TriggerDispatcherName, dispatch?>` so a single `syncWebhook` mutation can `switch (args.dispatcher)` and run the matching upsert + sync trigger (identical logic to `createUpsertDispatcher`, just keyed). Likewise build a `Record<AsyncHookName, handler?>` so a single `asyncWebhook` action runs `handlers[args.hook]?.(ctx, args.doc)`.

**Step 1: Write the failing test** (returns two functions, names stable):

```ts
// src/client/webhook-handlers.test.ts
import { describe, expect, it } from "vitest";
import { BetterStripe } from "./index.js";

const fakeComponent = {} as never;

describe("webhookHandlers()", () => {
  it("returns syncWebhook + asyncWebhook function definitions", () => {
    const stripe = new BetterStripe(fakeComponent, { STRIPE_SECRET_KEY: "sk_test_x" });
    const handlers = stripe.webhookHandlers();
    expect(handlers).toHaveProperty("syncWebhook");
    expect(handlers).toHaveProperty("asyncWebhook");
    expect(Object.keys(handlers)).toHaveLength(2);
  });
});
```

**Step 2:** `npx vitest run src/client/webhook-handlers.test.ts` → FAIL (`webhookHandlers` not a function).

**Step 3: Implement `webhookHandlers()`** in `src/client/index.ts`. Extract the existing `DispatcherSpec` table + `splitCreateUpdate` + `createUpsertDispatcher` body into a single routing mutation, and the `createAsyncHook` map into a single routing action:

```ts
webhookHandlers(): WebhookHandlerRefs {
  const component = this.component;
  const triggers = this._triggers;
  const hooks = this._hooks;

  // dispatcher name -> { spec, dispatch? }  (same specs as the old triggersApi)
  const SYNC: Record<TriggerDispatcherName, { spec: DispatcherSpec; dispatch?: Dispatch }> = {
    accountUpserted: { spec: {...}, dispatch: splitCreateUpdate(triggers?.account?.onCreate, triggers?.account?.onUpdate) },
    // ...products, prices, subscriptionUpserted, checkoutSessionUpserted (transition-to-complete),
    //    invoiceUpserted, paymentUpserted, payoutUpserted, subscriptionDeleted (special: upsert + onDelete)
  };

  const ASYNC: Record<AsyncHookName, ((ctx: AsyncHookCtx, doc: unknown) => Promise<void>) | undefined> = {
    afterAccountUpdated: hooks?.onAccountUpdated,
    afterCheckoutCompleted: hooks?.onCheckoutCompleted,
    // ...the rest, identical mapping to the old triggersApi
  };

  const syncWebhook = internalMutationGeneric({
    args: { dispatcher: v.string(), data: v.any() },
    returns: v.null(),
    handler: async (ctx, { dispatcher, data }) => {
      const entry = SYNC[dispatcher as TriggerDispatcherName];
      if (!entry) throw new Error(`[better-stripe] unknown dispatcher: ${dispatcher}`);
      await runUpsertAndTrigger(ctx, component, entry.spec, entry.dispatch, data as Record<string, unknown>);
      return null;
    },
  });

  const asyncWebhook = internalActionGeneric({
    args: { hook: v.string(), doc: v.any() },
    returns: v.null(),
    handler: async (ctx, { hook, doc }) => {
      await ASYNC[hook as AsyncHookName]?.(ctx as unknown as AsyncHookCtx, doc);
      return null;
    },
  });

  return { syncWebhook, asyncWebhook } as unknown as WebhookHandlerRefs;
}
```

Where `runUpsertAndTrigger` is the extracted body of today's `createUpsertDispatcher` handler (pre-read oldDoc, upsert, re-read newDoc, dispatch), and `subscriptionDeleted` keeps its special upsert-then-onDelete path inside the `SYNC` table's dispatch.

**Step 4:** `npx vitest run src/client/webhook-handlers.test.ts` → PASS.

**Step 5:** Add a behavior test (convex-test) asserting `syncWebhook({dispatcher:"subscriptionUpserted", data})` upserts the component subscription AND fires `triggers.subscription.onUpdate` in one transaction (model on existing `src/component/triggers.test.ts` / `src/client` dispatch tests). Verify a throwing trigger rolls back the upsert.

**Step 6:** `npx vitest run` → PASS. Commit: `git commit -m "feat(webhooks): add webhookHandlers() routing pair"`

---

## Task 3: Switch handler consumption to the two refs

**Files:**
- Modify: `src/client/types/options.ts` (RegisterRoutesConfig: add `webhooks?: WebhookHandlerRefs`, remove `triggers?: TriggerApiRefs`)
- Modify: `src/client/webhooks/helpers.ts:221` (`dispatchUpsert`)
- Modify: `src/client/webhooks/hooks.ts:119` (`scheduleAsyncHook`)

**Step 1:** Update `dispatchUpsert` to route through the single sync ref:

```ts
const refs = whCtx.config?.webhooks;
if (refs) {
  await whCtx.ctx.runMutation(refs.syncWebhook, { dispatcher: dispatcherName, data });
} else {
  await whCtx.ctx.runMutation(componentRef(whCtx.component, DISPATCHER_UPSERT_PATHS[dispatcherName]), data);
}
```

**Step 2:** Update `scheduleAsyncHook`:

```ts
const refs = whCtx.config?.webhooks;
if (!refs) return;
// ...fetch committed doc as today...
if (doc) await scheduler.runAfter(0, refs.asyncWebhook, { hook: spec.hook, doc });
```

**Step 3:** Update existing webhook-handler tests to pass `{ webhooks: ... }` instead of `{ triggers: ... }`. `npx vitest run` → PASS.

**Step 4:** `pnpm typecheck:lib` → PASS. Commit: `git commit -m "feat(webhooks): consume syncWebhook/asyncWebhook refs"`

---

## Task 4: Remove `triggersApi()` (clean cutover)

**Files:**
- Modify: `src/client/index.ts` (delete `triggersApi()` method, lines ~990-1282; keep the extracted helpers used by `webhookHandlers()`)
- Modify: `src/client/types/triggers.ts` (remove `TriggerApiRefs`; KEEP `TriggerDispatcherName`, `AsyncHookName`, `SyncTriggers`, `AsyncHooks` — still used)
- Modify: any barrel exports referencing `TriggerApiRefs`

**Step 1:** Delete and fix references. **Step 2:** `pnpm typecheck && pnpm lint && npx vitest run` → all PASS. **Step 3:** Commit: `git commit -m "feat(webhooks)!: remove triggersApi() in favor of webhookHandlers()"`

---

## Task 5: Migrate the example app

**Files:**
- Modify: `example/convex/stripe.ts` — replace the `triggersApi()` destructure with `export const { syncWebhook, asyncWebhook } = stripe.webhookHandlers();`
- Modify: `example/convex/http.ts` — `registerRoutes(http, components.betterStripe, { ...secrets, webhooks: internal.stripe })`

**Steps:** `pnpm build` → regen example codegen → `pnpm --filter ./example exec convex dev --once` (PASS: Convex functions ready) → `pnpm typecheck` → PASS. Commit.

---

## Task 6: Docs

**Files:** `README.md` (Quick Start step 2/3 + any `triggersApi` mention), the design doc status.

Update the export from the 18-name destructure to `webhookHandlers()`, and `registerRoutes` `triggers:` → `webhooks:`. `npx prettier --write` the touched files. Commit.

---

## Task 7: Migrate dojo (sequenced, separate repo)

`/Users/kellykampen/code/dojo/dojo/packages/backend/convex` consumes the published `@getdojo/better-stripe`. Order: (1) release better-stripe with this change; (2) bump dojo's dependency; (3) update dojo's stripe module to `webhookHandlers()` + `registerRoutes(..., { webhooks: ... })`. Confirm dojo's exact current usage first (the audit saw a `registerStripeComponentWebhook` wrapper — reconcile before editing). Out of scope for the better-stripe PR; tracked as a follow-up.

---

## Definition of done

- `pnpm typecheck`, `pnpm lint`, `pnpm test` all green.
- `convex dev --once` on the example pushes cleanly.
- `triggersApi()` fully removed; `webhookHandlers()` is the only registration path.
- README reflects the new 2-export API.
- dojo migration tracked as a sequenced follow-up.
