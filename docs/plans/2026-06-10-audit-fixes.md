# Audit Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire up the dead trigger/hook system so webhook events actually invoke app callbacks with same-transaction semantics, implement the missing documented APIs, and fix the component/react/example/docs issues found in the 2026-06-10 audit.

**Architecture:** The trigger fix follows the `@convex-dev/better-auth` pattern: `triggersApi()` is redesigned to return *dispatcher* internal mutations that perform the component table upsert AND the app's sync-trigger callback inside one app-level mutation (Convex component calls inside a mutation are atomic with it — a throwing callback rolls back the upsert, causing Stripe to retry). The app exports these dispatchers and passes their function references to `registerRoutes` via a new `triggers` config field. Webhook processors route upserts through the dispatchers when configured, falling back to direct component mutations otherwise. Async hooks are scheduled by the handler via `ctx.scheduler.runAfter(0, ...)` after the ledger marks the event processed.

**Tech Stack:** Convex components, Stripe SDK v22, TypeScript, vitest (edge-runtime env for webhook tests), React 19.

**Conventions for the executor:**

- Repo root: `/Users/kellykampen/code/tiny-projects/better-stripe`. Package manager: `pnpm`.
- Run all tests: `pnpm test`. Single file: `pnpm vitest run src/client/index.test.ts`. Typecheck: `pnpm typecheck`. Lint: `pnpm lint:lib`.
- All client→component calls go through `componentRef(component, "<domain>/<kind>/<name>")` from `src/client/webhooks/helpers.ts`. New component functions MUST also be added to `COMPONENT_FUNCTION_MAP` in that file.
- Errors thrown across the Convex boundary use the helpers in `src/client/errors.ts` (`ConvexError` with `BetterStripeError` payload) — do not throw plain `Error` in new client code.
- The package name is `@getdojo/better-stripe` (NOT `better-stripe`). All docs must use the scoped name.
- **Commit policy: Kelly requires explicit approval for commits. At each "Commit" step, stage the files and show the proposed message, but only run `git commit` if this session has been told commits are approved.**
- Before starting: `git checkout -b fix/audit-findings` from `develop`.

---

## Phase 0 — Missing component queries (prerequisite for dispatchers)

### Task 0.1: Add `getInvoiceByStripeId` component query

**Files:**
- Modify: `src/component/billing/queries.ts`
- Modify: `src/client/webhooks/helpers.ts` (COMPONENT_FUNCTION_MAP)
- Test: `src/component/public.test.ts` (follow existing convex-test patterns in that file)

**Step 1: Write the failing test** — in `src/component/public.test.ts`, following the existing test style there (convex-test with the component schema):

```typescript
test("getInvoiceByStripeId returns the invoice after upsert", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.billing.mutations.upsertInvoice, {
    stripeInvoiceId: "in_test_123",
    userId: "user_1",
    status: "paid",
    currency: "usd",
    amountDue: 1000,
    amountPaid: 1000,
  });
  const invoice = await t.query(api.billing.queries.getInvoiceByStripeId, {
    stripeInvoiceId: "in_test_123",
  });
  expect(invoice?.stripeInvoiceId).toBe("in_test_123");

  const missing = await t.query(api.billing.queries.getInvoiceByStripeId, {
    stripeInvoiceId: "in_nope",
  });
  expect(missing).toBeNull();
});
```

(Adapt `api.` paths and `upsertInvoice` args to match the file's existing imports and the validator in `src/component/billing/validators.ts` — check required fields before writing.)

**Step 2: Run test, verify it fails** — `pnpm vitest run src/component/public.test.ts` → FAIL ("getInvoiceByStripeId" not found).

**Step 3: Implement** — in `src/component/billing/queries.ts`, mirroring `getSubscriptionByStripeId` (line 17):

```typescript
export const getInvoiceByStripeId = query({
  args: { stripeInvoiceId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("invoices")
      .withIndex("by_stripe_invoice_id", (q) =>
        q.eq("stripeInvoiceId", args.stripeInvoiceId),
      )
      .first();
  },
});
```

Add to `COMPONENT_FUNCTION_MAP` in `src/client/webhooks/helpers.ts` (Billing section):
`getInvoiceByStripeId: "billing/queries/getInvoiceByStripeId",`

**Step 4: Run test, verify it passes.** Then `pnpm typecheck:lib`.

**Step 5: Commit** — `feat(component): add getInvoiceByStripeId query`

### Task 0.2: Add `getPaymentByStripeId` component query

Same shape as Task 0.1.

**Files:**
- Modify: `src/component/connect/queries.ts`
- Modify: `src/client/webhooks/helpers.ts`
- Test: `src/component/public.test.ts`

Implementation (index `by_stripe_payment_intent_id` already exists in `src/component/connect/schema.ts:19`):

```typescript
export const getPaymentByStripeId = query({
  args: { stripePaymentIntentId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("payments")
      .withIndex("by_stripe_payment_intent_id", (q) =>
        q.eq("stripePaymentIntentId", args.stripePaymentIntentId),
      )
      .first();
  },
});
```

COMPONENT_FUNCTION_MAP: `getPaymentByStripeId: "connect/queries/getPaymentByStripeId",`. Also verify `getPayout`'s arg (used later by hook scheduling): check `src/component/connect/queries.ts` — if it takes a Convex `_id` rather than `stripePayoutId`, add a `getPayoutByStripeId` query too (index `by_stripe_payout_id` — confirm name in `connect/schema.ts`).

TDD steps + commit as in Task 0.1. Message: `feat(component): add getPaymentByStripeId query`.

---

## Phase 1 — Wire up the trigger/hook system

### Task 1.1: Define `TriggerApiRefs` type and extend `RegisterRoutesConfig`

**Files:**
- Modify: `src/client/types/triggers.ts`
- Modify: `src/client/types/options.ts`
- Modify: `src/client/types/events.ts` (`WebhookActionCtx`)
- Modify: `src/client/types/index.ts` + `src/client/index.ts` (re-exports)

**Step 1:** Add to `src/client/types/triggers.ts`:

```typescript
// ---------------------------------------------------------------------------
// Trigger API function references (passed to registerRoutes by the app)
// ---------------------------------------------------------------------------

/** Internal mutation that upserts a component doc and runs the sync trigger. */
export type TriggerDispatchRef = FunctionReference<
  "mutation",
  "internal",
  { data: Record<string, unknown> },
  null
>;

/** Internal action that runs an async hook with the committed doc. */
export type AsyncHookRef = FunctionReference<
  "action",
  "internal",
  { doc: Record<string, unknown> },
  null
>;

/**
 * Function references to the wrappers returned by `triggersApi()`.
 * The app exports them from a Convex module and passes that module here:
 * `triggers: internal.stripe as unknown as TriggerApiRefs`.
 * All fields optional — the handler falls back to direct component
 * upserts for any dispatcher that is missing.
 */
export type TriggerApiRefs = Partial<{
  accountUpserted: TriggerDispatchRef;
  productUpserted: TriggerDispatchRef;
  priceUpserted: TriggerDispatchRef;
  subscriptionUpserted: TriggerDispatchRef;
  subscriptionDeleted: TriggerDispatchRef;
  checkoutSessionUpserted: TriggerDispatchRef;
  invoiceUpserted: TriggerDispatchRef;
  paymentUpserted: TriggerDispatchRef;
  payoutUpserted: TriggerDispatchRef;
  afterAccountUpdated: AsyncHookRef;
  afterCheckoutCompleted: AsyncHookRef;
  afterSubscriptionUpdated: AsyncHookRef;
  afterSubscriptionCanceled: AsyncHookRef;
  afterTrialEnding: AsyncHookRef;
  afterInvoicePaid: AsyncHookRef;
  afterPaymentSucceeded: AsyncHookRef;
  afterPaymentFailed: AsyncHookRef;
  afterPayoutCompleted: AsyncHookRef;
}>;
```

**Step 2:** In `src/client/types/options.ts`, add to `RegisterRoutesConfig`:

```typescript
  /**
   * Function references to the app's exported `triggersApi()` wrappers.
   * When provided, webhook upserts run through these dispatchers so sync
   * triggers execute in the same transaction as the component write, and
   * async hooks are scheduled after commit.
   */
  triggers?: TriggerApiRefs;
```

(import `TriggerApiRefs` from `./triggers.js`).

**Step 3:** In `src/client/types/events.ts`, add an optional `scheduler` to `WebhookActionCtx` (line 53):

```typescript
import type { Scheduler } from "convex/server";
// in WebhookActionCtx:
  scheduler?: Pick<Scheduler, "runAfter">;
```

(The hand-rolled `runAfter` shape is NOT assignable from Convex's real `Scheduler` — the real `runAfter` uses `OptionalRestArgs` rest-tuple args, so `GenericActionCtx` would fail to assign. `Pick<Scheduler, "runAfter">` matches exactly.)

**Step 4:** Re-export `TriggerApiRefs`, `TriggerDispatchRef`, `AsyncHookRef` from `src/client/types/index.ts` and `src/client/index.ts` (alongside the existing `SyncTriggers`/`AsyncHooks` exports — check how those are exported and match).

**Step 5:** `pnpm typecheck:lib` → clean. Commit: `feat(client): add TriggerApiRefs type and triggers field on RegisterRoutesConfig`

### Task 1.2: Redesign `triggersApi()` to return upsert dispatchers

**Files:**
- Modify: `src/client/index.ts:947-1026` (`triggersApi`)
- Test: `src/client/index.test.ts` (existing triggersApi tests will break — update them)

**Step 1: Write failing tests** in `src/client/index.test.ts` (follow the file's existing mock patterns — it already tests `triggersApi()` with mock ctx; find those tests and replace). Key behaviors:

```typescript
describe("triggersApi dispatchers", () => {
  it("subscriptionUpserted: upserts then calls onCreate when no prior doc", async () => {
    const onCreate = vi.fn();
    const stripe = new BetterStripe(mockComponent, {
      STRIPE_SECRET_KEY: "sk_test_x",
      triggers: { subscription: { onCreate } },
    });
    const apiObj = stripe.triggersApi();
    const ctx = {
      // first runQuery (old doc) → null, second (new doc) → the doc
      runQuery: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ stripeSubscriptionId: "sub_1", status: "active" }),
      runMutation: vi.fn().mockResolvedValue(null),
    };
    // internalMutationGeneric exposes the handler via ._handler in convex —
    // check how existing tests in this file invoke the wrappers and do the same.
    await invokeRegisteredFunction(apiObj.subscriptionUpserted, ctx, {
      data: { stripeSubscriptionId: "sub_1", status: "active" },
    });
    expect(ctx.runMutation).toHaveBeenCalledTimes(1); // component upsert
    expect(onCreate).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ stripeSubscriptionId: "sub_1" }),
    );
  });

  it("subscriptionUpserted: calls onUpdate(new, old) when doc exists", async () => { /* runQuery returns old then new */ });

  it("checkoutSessionUpserted: fires onCompleted only on transition to complete", async () => {
    // old status "open" + new "complete" → fires; old "complete" → does NOT fire
  });

  it("subscriptionDeleted: upserts then calls onDelete with the doc", async () => { /* ... */ });

  it("propagates trigger errors (rollback semantics)", async () => {
    // onCreate throws → the dispatcher handler rejects
  });

  it("works with no triggers configured (upsert only, no throw)", async () => { /* ... */ });
});
```

(`invokeRegisteredFunction` = however the existing tests in this file call the `internalMutationGeneric` wrappers — reuse that mechanism, do not invent a new one. If the existing tests construct wrappers and call `wrapper._handler(ctx, args)` or similar, follow suit.)

**Step 2: Run, verify failures.** `pnpm vitest run src/client/index.test.ts`

**Step 3: Implement.** Replace the body of `triggersApi()` in `src/client/index.ts`:

```typescript
  triggersApi() {
    const component = this.component;
    const triggers = this._triggers;
    const hooks = this._hooks;

    type DispatcherSpec = {
      getter: string; // component query path
      idArg: string; // query arg name
      idField: string; // field in `data` holding the Stripe id
      upsert: string; // component mutation path
    };

    const createUpsertDispatcher = <T>(
      spec: DispatcherSpec,
      onCreate?: (ctx: SyncTriggerCtx, doc: T) => Promise<void>,
      onUpdate?: (ctx: SyncTriggerCtx, newDoc: T, oldDoc: T) => Promise<void>,
    ) =>
      internalMutationGeneric({
        args: { data: v.any() },
        returns: v.null(),
        handler: async (ctx, { data }) => {
          const lookup = { [spec.idArg]: data[spec.idField] };
          const oldDoc = (await ctx.runQuery(
            componentRef(component, spec.getter),
            lookup,
          )) as T | null;
          await ctx.runMutation(componentRef(component, spec.upsert), data);
          const newDoc = (await ctx.runQuery(
            componentRef(component, spec.getter),
            lookup,
          )) as T;
          if (oldDoc === null) {
            await onCreate?.(ctx, newDoc);
          } else {
            await onUpdate?.(ctx, newDoc, oldDoc);
          }
          return null;
        },
      });

    const createAsyncHook = <T>(
      handler?: (ctx: AsyncHookCtx, doc: T) => Promise<void>,
    ) =>
      internalActionGeneric({
        args: { doc: v.any() },
        returns: v.null(),
        handler: async (ctx, args) => {
          await handler?.(ctx, args.doc as T);
          return null;
        },
      });

    return {
      // --- Sync dispatchers: component upsert + trigger, one transaction ---
      accountUpserted: createUpsertDispatcher(
        {
          getter: "core/queries/getAccountByStripeId",
          idArg: "stripeAccountId",
          idField: "stripeAccountId",
          upsert: "core/mutations/upsertAccountInternal",
        },
        triggers?.account?.onCreate,
        triggers?.account?.onUpdate,
      ),
      productUpserted: createUpsertDispatcher(
        {
          getter: "products/queries/getProductByStripeId",
          idArg: "stripeProductId",
          idField: "stripeProductId",
          upsert: "products/mutations/upsertProduct",
        },
        triggers?.product?.onCreate,
        triggers?.product?.onUpdate,
      ),
      priceUpserted: createUpsertDispatcher(
        {
          getter: "products/queries/getPriceByStripeId",
          idArg: "stripePriceId",
          idField: "stripePriceId",
          upsert: "products/mutations/upsertPrice",
        },
        triggers?.price?.onCreate,
        triggers?.price?.onUpdate,
      ),
      subscriptionUpserted: createUpsertDispatcher(
        {
          getter: "billing/queries/getSubscriptionByStripeId",
          idArg: "stripeSubscriptionId",
          idField: "stripeSubscriptionId",
          upsert: "billing/mutations/upsertSubscription",
        },
        triggers?.subscription?.onCreate,
        triggers?.subscription?.onUpdate,
      ),
      subscriptionDeleted: internalMutationGeneric({
        args: { data: v.any() },
        returns: v.null(),
        handler: async (ctx, { data }) => {
          await ctx.runMutation(
            componentRef(component, "billing/mutations/upsertSubscription"),
            data,
          );
          const doc = await ctx.runQuery(
            componentRef(component, "billing/queries/getSubscriptionByStripeId"),
            { stripeSubscriptionId: data.stripeSubscriptionId },
          );
          await triggers?.subscription?.onDelete?.(ctx, doc);
          return null;
        },
      }),
      checkoutSessionUpserted: internalMutationGeneric({
        args: { data: v.any() },
        returns: v.null(),
        handler: async (ctx, { data }) => {
          const lookup = { stripeSessionId: data.stripeSessionId };
          const oldDoc = await ctx.runQuery(
            componentRef(component, "billing/queries/getCheckoutSessionByStripeId"),
            lookup,
          );
          await ctx.runMutation(
            componentRef(component, "billing/mutations/upsertCheckoutSession"),
            data,
          );
          const newDoc = await ctx.runQuery(
            componentRef(component, "billing/queries/getCheckoutSessionByStripeId"),
            lookup,
          );
          // Fire onCompleted exactly once: on the transition into "complete".
          if (
            newDoc?.status === "complete" &&
            oldDoc?.status !== "complete"
          ) {
            await triggers?.checkoutSession?.onCompleted?.(ctx, newDoc);
          }
          return null;
        },
      }),
      invoiceUpserted: createUpsertDispatcher(
        {
          getter: "billing/queries/getInvoiceByStripeId",
          idArg: "stripeInvoiceId",
          idField: "stripeInvoiceId",
          upsert: "billing/mutations/upsertInvoice",
        },
        triggers?.invoice?.onCreate,
        triggers?.invoice?.onUpdate,
      ),
      paymentUpserted: createUpsertDispatcher(
        {
          getter: "connect/queries/getPaymentByStripeId",
          idArg: "stripePaymentIntentId",
          idField: "stripePaymentIntentId",
          upsert: "connect/mutations/upsertPayment",
        },
        triggers?.payment?.onCreate,
        undefined, // payment has no onUpdate in SyncTriggers
      ),
      payoutUpserted: createUpsertDispatcher(
        {
          getter: "connect/queries/getPayoutByStripeId", // from Task 0.2 — use actual name
          idArg: "stripePayoutId",
          idField: "stripePayoutId",
          upsert: "connect/mutations/upsertPayout",
        },
        triggers?.payout?.onCreate,
        triggers?.payout?.onUpdate,
      ),

      // --- Async hook wrappers (scheduled by the webhook handler) ---
      afterAccountUpdated: createAsyncHook(hooks?.onAccountUpdated),
      afterCheckoutCompleted: createAsyncHook(hooks?.onCheckoutCompleted),
      afterSubscriptionUpdated: createAsyncHook(hooks?.onSubscriptionUpdated),
      afterSubscriptionCanceled: createAsyncHook(hooks?.onSubscriptionCanceled),
      afterTrialEnding: createAsyncHook(hooks?.onTrialEnding),
      afterInvoicePaid: createAsyncHook(hooks?.onInvoicePaid),
      afterPaymentSucceeded: createAsyncHook(hooks?.onPaymentSucceeded),
      afterPaymentFailed: createAsyncHook(hooks?.onPaymentFailed),
      afterPayoutCompleted: createAsyncHook(hooks?.onPayoutCompleted),
    };
  }
```

Notes for the executor:
- `SyncTriggerCtx`/`AsyncHookCtx` imports already exist in the file's type imports — verify.
- The ctx passed by `internalMutationGeneric` is the real mutation ctx; the `SyncTriggerCtx` type in callbacks is structurally compatible. Cast where TS complains: `ctx as unknown as SyncTriggerCtx`.
- Delete the old `createCreateTrigger`/`createUpdateTrigger` helpers and old return-object names (`onAccountCreated`, etc.). This is a breaking rename of dead code — nothing external consumed it except the example app (updated in Task 1.6).

**Step 4: Run tests** — `pnpm vitest run src/client/index.test.ts` → PASS. Run full `pnpm test` — the example's typecheck will still fail until Task 1.6; lib tests must pass.

**Step 5: Commit** — `feat(client)!: triggersApi dispatchers perform upsert + trigger in one transaction`

### Task 1.3: Route webhook upserts through dispatchers

**Files:**
- Modify: `src/client/webhooks/helpers.ts` (add `dispatchUpsert`)
- Modify: `src/client/webhooks/processors.ts` (all 7 handlers)
- Modify: `src/client/webhooks/v2.ts` (account upsert)
- Test: `src/client/webhooks.test.ts`

**Step 1: Write failing tests** in `src/client/webhooks.test.ts` (the file already has full mock plumbing — `createMockCtx`, `createMockComponent`, captured handler):

```typescript
describe("trigger dispatch", () => {
  it("routes subscription upsert through config.triggers.subscriptionUpserted", async () => {
    const subscriptionUpserted = makeRef("app/stripe/subscriptionUpserted");
    // build config with triggers: { subscriptionUpserted }
    // send a customer.subscription.updated event
    // expect ctx.runMutation called with subscriptionUpserted ref and { data: {...} }
    // expect NO direct call to billing/mutations/upsertSubscription
  });

  it("falls back to direct component upsert when no trigger ref", async () => { /* existing behavior preserved */ });

  it("uses subscriptionDeleted dispatcher for customer.subscription.deleted", async () => { /* ... */ });

  it("routes V2 account sync through accountUpserted dispatcher", async () => { /* ... */ });
});
```

**Step 2: Run, verify failures.**

**Step 3: Implement.** In `src/client/webhooks/helpers.ts` add:

```typescript
import type { TriggerApiRefs } from "../types/triggers.js";

/**
 * Run a domain upsert. When the app registered a trigger dispatcher for this
 * domain, route through it so the sync trigger runs in the same transaction
 * as the component write. Otherwise call the component mutation directly.
 */
export async function dispatchUpsert(
  whCtx: WebhookContext,
  dispatcherName: keyof TriggerApiRefs,
  componentMutationPath: string,
  data: Record<string, unknown>,
): Promise<void> {
  const ref = whCtx.config?.triggers?.[dispatcherName];
  if (ref) {
    await whCtx.ctx.runMutation(ref as TriggerDispatchRef, { data });
  } else {
    await whCtx.ctx.runMutation(
      componentRef(whCtx.component, componentMutationPath),
      data,
    );
  }
}
```

In `src/client/webhooks/processors.ts`, replace each final `ctx.runMutation(componentRef(...), {...})` with `dispatchUpsert(whCtx, <name>, <path>, {...})`:

| Handler | dispatcherName | componentMutationPath |
|---|---|---|
| `handleProductEvent` | `"productUpserted"` | `"products/mutations/upsertProduct"` |
| `handlePriceEvent` (final upsert only — the auto-create-product fallback at line 107 stays a direct component call) | `"priceUpserted"` | `"products/mutations/upsertPrice"` |
| `upsertSubscriptionFromStripe` | `"subscriptionUpserted"` or `"subscriptionDeleted"` — pass the event type down: in `processEvent`, split `customer.subscription.deleted` into its own call path | `"billing/mutations/upsertSubscription"` |
| `handleCheckoutEvent` | `"checkoutSessionUpserted"` | `"billing/mutations/upsertCheckoutSession"` |
| `upsertInvoiceFromStripe` | `"invoiceUpserted"` | `"billing/mutations/upsertInvoice"` |
| `upsertPaymentFromStripe` | `"paymentUpserted"` | `"connect/mutations/upsertPayment"` |
| `handlePayoutEvent` | `"payoutUpserted"` | `"connect/mutations/upsertPayout"` |

In `src/client/webhooks/v2.ts:95`, replace the `upsertAccountInternal` runMutation with `dispatchUpsert(whCtx, "accountUpserted", "core/mutations/upsertAccountInternal", {...})`.

Note: `handleCheckoutEvent`'s pre-existing metadata merge (lines 208-223) stays in the processor — the dispatcher receives the already-merged metadata in `data`.

**Step 4: Run** — `pnpm vitest run src/client/webhooks.test.ts` then `pnpm test`.

**Step 5: Commit** — `feat(webhooks): route upserts through trigger dispatchers when configured`

### Task 1.4: Schedule async hooks from the webhook handler

**Files:**
- Modify: `src/client/webhooks/hooks.ts` (add `scheduleAsyncHooks` + event→hook map)
- Modify: `src/client/webhooks/handler.ts` (call it after markProcessed; have `handleV2Event` return the account id)
- Modify: `src/client/webhooks/v2.ts` (return `string | null` account id)
- Test: `src/client/webhooks.test.ts`

**Step 1: Failing tests:**

```typescript
describe("async hook scheduling", () => {
  it("schedules afterCheckoutCompleted with the committed doc", async () => {
    // config.triggers.afterCheckoutCompleted = ref; ctx.scheduler = { runAfter: vi.fn() }
    // ctx.runQuery for getCheckoutSessionByStripeId resolves the doc
    // send checkout.session.completed → expect scheduler.runAfter(0, ref, { doc })
  });
  it("schedules afterSubscriptionCanceled on customer.subscription.deleted", async () => { /* ... */ });
  it("does not schedule when no scheduler or no ref (no throw)", async () => { /* ... */ });
  it("schedules afterAccountUpdated for v2 account events", async () => { /* ... */ });
});
```

Update `createMockCtx` to accept a `scheduler` override.

**Step 2: Run, verify failures.**

**Step 3: Implement.** In `src/client/webhooks/hooks.ts`:

```typescript
import type { TriggerApiRefs } from "../types/triggers.js";
import { type WebhookContext, componentRef } from "./helpers.js";

type HookSpec = {
  hook: keyof TriggerApiRefs;
  getter: string; // component query path
  idArg: string;
};

/** V1 event type → async hook + component query to fetch the committed doc. */
const HOOK_EVENT_MAP: Record<string, HookSpec> = {
  "checkout.session.completed": {
    hook: "afterCheckoutCompleted",
    getter: "billing/queries/getCheckoutSessionByStripeId",
    idArg: "stripeSessionId",
  },
  "customer.subscription.created": {
    hook: "afterSubscriptionUpdated",
    getter: "billing/queries/getSubscriptionByStripeId",
    idArg: "stripeSubscriptionId",
  },
  "customer.subscription.updated": {
    hook: "afterSubscriptionUpdated",
    getter: "billing/queries/getSubscriptionByStripeId",
    idArg: "stripeSubscriptionId",
  },
  "customer.subscription.deleted": {
    hook: "afterSubscriptionCanceled",
    getter: "billing/queries/getSubscriptionByStripeId",
    idArg: "stripeSubscriptionId",
  },
  "customer.subscription.trial_will_end": {
    hook: "afterTrialEnding",
    getter: "billing/queries/getSubscriptionByStripeId",
    idArg: "stripeSubscriptionId",
  },
  "invoice.paid": {
    hook: "afterInvoicePaid",
    getter: "billing/queries/getInvoiceByStripeId",
    idArg: "stripeInvoiceId",
  },
  "payment_intent.succeeded": {
    hook: "afterPaymentSucceeded",
    getter: "connect/queries/getPaymentByStripeId",
    idArg: "stripePaymentIntentId",
  },
  "payment_intent.payment_failed": {
    hook: "afterPaymentFailed",
    getter: "connect/queries/getPaymentByStripeId",
    idArg: "stripePaymentIntentId",
  },
  "payout.paid": {
    hook: "afterPayoutCompleted",
    getter: "connect/queries/getPayoutByStripeId",
    idArg: "stripePayoutId",
  },
};

/**
 * Schedule the app's async hook for this event, if configured.
 * Runs after the component write committed — failures are logged, never thrown.
 */
export async function scheduleAsyncHooks(
  whCtx: WebhookContext,
  eventType: string,
  stripeObjectId: string | null | undefined,
): Promise<void> {
  const spec = eventType.startsWith("v2.core.account")
    ? ({
        hook: "afterAccountUpdated",
        getter: "core/queries/getAccountByStripeId",
        idArg: "stripeAccountId",
      } as HookSpec)
    : HOOK_EVENT_MAP[eventType];
  if (!spec || !stripeObjectId) return;

  const ref = whCtx.config?.triggers?.[spec.hook];
  const scheduler = whCtx.ctx.scheduler;
  if (!ref || !scheduler) return;

  try {
    const doc = await whCtx.ctx.runQuery(
      componentRef(whCtx.component, spec.getter),
      { [spec.idArg]: stripeObjectId },
    );
    if (doc) {
      await scheduler.runAfter(0, ref as AsyncHookRef, { doc });
    }
  } catch (error) {
    console.error(
      `[better-stripe] Failed to schedule async hook for ${eventType}:`,
      error,
    );
  }
}
```

In `src/client/webhooks/v2.ts`: change `handleV2Event` return type to `Promise<string | null>` — return `account.id` after the upsert, `null` on the early-return paths.

In `src/client/webhooks/handler.ts`:
- V2 path: capture `const accountId = await handleV2Event(whCtx, thinEvent);` (line 116), then after markProcessed (after line 146): `await scheduleAsyncHooks(whCtx, thinEvent.type, accountId);` (before the existing `runHooks` call).
- V1 path: after markProcessed (after line 235), before `runHooks`:
  ```typescript
  const objectId = (event.data.object as { id?: string }).id ?? null;
  await scheduleAsyncHooks(whCtx, event.type, objectId);
  ```
- Keep `runHooks` (the `onEvent`/`events` escape hatches) unchanged.

**Step 4: Run** — `pnpm vitest run src/client/webhooks.test.ts`, then `pnpm test`.

**Step 5: Commit** — `feat(webhooks): schedule async hooks after event commit`

### Task 1.5: Support `customer.subscription.trial_will_end`

**Files:**
- Modify: `src/client/utils/webhookEndpoints.ts:13` (`BETTER_STRIPE_WEBHOOK_EVENTS` — add the event)
- Modify: `src/client/webhooks/processors.ts` (`processEvent`: add the case to the subscription group so the sub gets upserted)
- Test: `src/client/webhooks.test.ts` (event processed + `afterTrialEnding` scheduled — partially covered by Task 1.4 test)

TDD steps as above. Note the README "Supported Events" list and event-count comments (e.g. "19 events") must be updated — defer the README edit to Task 6.1, but update any count assertions in tests now (`grep -rn "19" src/client/utils/webhookEndpoints.ts src/**/*.test.ts`).

Commit: `feat(webhooks): handle customer.subscription.trial_will_end`

### Task 1.6: Update the example app to the new contract

**Files:**
- Modify: `example/convex/stripe.ts`
- Modify: `example/convex/http.ts`

**Step 1:** In `example/convex/stripe.ts`, replace the export block (lines 54-60) with the full new surface:

```typescript
// Export trigger dispatchers + async hooks; http.ts passes their refs to registerRoutes
export const {
  accountUpserted,
  productUpserted,
  priceUpserted,
  subscriptionUpserted,
  subscriptionDeleted,
  checkoutSessionUpserted,
  invoiceUpserted,
  paymentUpserted,
  payoutUpserted,
  afterAccountUpdated,
  afterCheckoutCompleted,
  afterSubscriptionUpdated,
  afterSubscriptionCanceled,
  afterTrialEnding,
  afterInvoicePaid,
  afterPaymentSucceeded,
  afterPaymentFailed,
  afterPayoutCompleted,
} = stripe.triggersApi();
```

Also add an `onUpdate` subscription trigger to the demo config so the wiring is visibly exercised (console.log like the others).

**Step 2:** In `example/convex/http.ts`:

```typescript
import { registerRoutes } from "@getdojo/better-stripe";
import type { TriggerApiRefs } from "@getdojo/better-stripe";
import { httpRouter } from "convex/server";

import { components, internal } from "./_generated/api";

const http = httpRouter();

registerRoutes(http, components.betterStripe, {
  webhookPath: "/stripe/webhook",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  webhookSecretV2: process.env.STRIPE_WEBHOOK_SECRET_V2,
  triggers: internal.stripe as unknown as TriggerApiRefs,
});

export default http;
```

**Step 3:** Build the lib first so the example resolves the new types (`pnpm build`), then `pnpm typecheck` (runs lib + example) → clean. Note: `example/convex/_generated/api.ts` may need `npx convex codegen` run from `example/` if exports changed — only if typecheck complains.

**Step 4:** Commit — `feat(example): wire trigger dispatchers into registerRoutes`

### Task 1.7: Manual end-to-end verification (checkpoint — needs Kelly or stripe CLI)

Run `pnpm dev` (starts example) with `stripe listen --forward-to <convex-url>/stripe/webhook`, complete a test checkout, and confirm the `[trigger] Checkout completed:` and `[hook] Invoice paid:` console.logs appear in the Convex logs. **If no Stripe test environment is available in this session, mark this task as deferred and tell Kelly — do not fake it.**

---

## Phase 2 — Missing / stubbed client APIs

### Task 2.1: `getInvoice` client method

**Files:**
- Modify: `src/client/billing/invoices.ts`
- Modify: `src/client/index.ts` (class method)
- Test: `src/client/index.test.ts`

Implementation mirrors `getSubscription`'s impl pattern (see `billing/subscriptions.ts`):

```typescript
export async function getInvoice(
  component: Component,
  ctx: RunCtx,
  opts: { stripeInvoiceId: string },
) {
  return await ctx.runQuery(
    componentRef(component, "billing/queries/getInvoiceByStripeId"),
    { stripeInvoiceId: opts.stripeInvoiceId },
  );
}
```

Class methods (next to `listInvoices`, `src/client/index.ts:681`): `getInvoice(ctx, opts)` and alias `getInvoiceByStripeId(ctx, opts)` (the README documents both). TDD + commit: `feat(client): add getInvoice query method`

### Task 2.2: `createAccountSession` client method

**Files:**
- Modify: `src/client/core/accountLinks.ts` (follow the file's existing impl/error-handling style — read it first)
- Modify: `src/client/index.ts` (class method near `createAccountLink`)
- Test: `src/client/index.test.ts` (mock `stripe.accountSessions.create`)

```typescript
export async function createAccountSession(
  stripe: Stripe,
  opts: {
    stripeAccountId: string;
    components: Stripe.AccountSessionCreateParams.Components;
  },
) {
  try {
    const session = await stripe.accountSessions.create({
      account: opts.stripeAccountId,
      components: opts.components,
    });
    return { clientSecret: session.client_secret };
  } catch (error) {
    throw toBetterStripeError(error, "STRIPE_API_ERROR"); // use the file's actual error helper
  }
}
```

(Check `src/client/errors.ts` for the real helper name; the Stripe SDK v22 type for `components` — verify with `node_modules/stripe` types. The mock Stripe class in tests needs `accountSessions = { create: vi.fn() }`.)

TDD + commit: `feat(client): add createAccountSession for embedded account management`

### Task 2.3: `setDefaultPaymentMethod` — document the limitation honestly

No code change (the stub at `src/client/connect/paymentMethods.ts:48` is an intentional V2 API limitation). Defer README edit to Task 6.1, which marks it: "Not supported for V2 accounts — throws with guidance to use `createBillingPortalSession()`." No commit.

---

## Phase 3 — Component quality

### Task 3.1: `clearAllTables` clears `webhookEvents` too

**File:** `src/component/core/mutations.ts` (~line 126 table list). Add `"webhookEvents"` to the `tables` array. Test: extend the existing clearAllTables test in `src/component/public.test.ts` (insert a webhook event via `webhooks/mutations/insertWebhookEvent`, clear, assert gone). TDD + commit: `fix(component): clearAllTables also clears webhookEvents ledger`

### Task 3.2: Add missing indexes

**Files:** `src/component/billing/schema.ts`, `src/component/connect/schema.ts`

- `checkoutSessions`: add `.index("by_account_id", ["accountId"])`
- `invoices`: add `.index("by_account_id", ["accountId"])`
- `payments`: add `.index("by_account_id", ["accountId"])`

(Only these three — YAGNI on org/status compound indexes until a query needs them; the in-memory status filters are acceptable at component scale and are lint-guarded.) Verify no existing query needs rewriting to use them yet; this unblocks the documented `listInvoices({ stripeAccountId })` filter — check `src/component/billing/queries.ts:199` `listInvoices`: if it currently filters `accountId` in memory, switch it to `withIndex("by_account_id", ...)` when the arg is provided.

Run `pnpm test && pnpm typecheck:lib`. Commit: `feat(component): index checkoutSessions/invoices/payments by accountId`

### Task 3.3: Remove `as any` casts on status filters

**Files:** `src/component/billing/queries.ts:43`, `src/component/connect/queries.ts:40`

Type the `status` arg with the proper validator from the domain's `validators.ts` (e.g. `subscriptionStatusValidator`) instead of `v.string()` + cast. Check each file's validators module for the exact export names. Run tests. Commit: `refactor(component): use typed status validators, drop as-any casts`

### Task 3.4: Replace `v.any()` return validators with real ones

**Files:** all `src/component/*/queries.ts` and `*/mutations.ts` (~27 instances)

Each domain has a `validators.ts` — add (or reuse) a doc validator per table including `_id: v.id("<table>")` and `_creationTime: v.number()`, then set `returns:` to `v.union(docValidator, v.null())` for getters, `v.array(docValidator)` for lists. Do one domain per sub-step (core → products → billing → connect → webhooks), running `pnpm test` after each. This is mechanical but high-touch; if any return shape doesn't match the schema (test failures will reveal it), fix the validator, not the data.

Commit per domain: `refactor(component): typed return validators for <domain>`

---

## Phase 4 — React fixes

### Task 4.1: `AddCardForm` tracks `isProcessing`/`error` for real

**File:** `src/react/components/AddCardForm.tsx`
**Test:** `src/react/index.test.ts` follows export-shape testing; behavioral state isn't unit-tested in this repo — keep it that way (no DOM test infra). Verify with typecheck + lint.

Replace the component body:

```tsx
export function AddCardForm({
  onSuccess,
  onError,
  submitLabel = "Add card",
  className,
  children,
}: AddCardFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!stripe || !elements || isProcessing) return;
    const cardElement = elements.getElement(CardElement);
    if (!cardElement) return;

    setIsProcessing(true);
    setError(null);
    try {
      const { error: stripeError, paymentMethod } =
        await stripe.createPaymentMethod({ type: "card", card: cardElement });
      if (stripeError) {
        const message = stripeError.message ?? "Failed to add card";
        setError(message);
        onError?.(message);
      } else if (paymentMethod) {
        onSuccess?.(paymentMethod.id);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  if (children) {
    return <>{children({ handleSubmit, isProcessing, error })}</>;
  }

  return (
    <div className={className}>
      <CardElement />
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!stripe || isProcessing}
      >
        {submitLabel}
      </button>
    </div>
  );
}
```

(import `useState` from react). Commit: `fix(react): AddCardForm tracks processing and error state`

### Task 4.2: `BillingPortalLink` tracks loading

**File:** `src/react/components/BillingPortalLink.tsx`

Add `const [isLoading, setIsLoading] = useState(false);` — set true around the `onCreateSession()` await (try/finally), pass real `isLoading` to the render prop, and in the default button render `isLoading ? loadingLabel : label` with `disabled={isLoading}` (the `loadingLabel` prop already exists and is currently unused — this fixes that too). Commit: `fix(react): BillingPortalLink tracks async loading state`

### Task 4.3: `AccountCreateCard` country placeholder prop

**File:** `src/react/components/AccountCreateCard.tsx:~100`

Add `countryPlaceholder?: string` prop (default `"Select a country…"`), use it for the placeholder `<option>`. Commit: `fix(react): i18n prop for AccountCreateCard country placeholder`

### Task 4.4: Resolve the `useAccount` placeholder

**File:** `src/react/hooks/useAccount.ts`

Read it and compare with a finished sibling (e.g. `src/react/hooks/useSubscription.ts`). Bring it to the same factory pattern (`createUseAccount(apiRef)` returning `{ account, isLoading }` via `useQuery`) and delete the placeholder comment. If it already works and only the comment is stale, just fix the comment. Commit: `fix(react): finalize useAccount hook`

---

## Phase 5 — Example cleanup

### Task 5.1: Billing portal via action, not hard-coded URL

**Files:** `example/src/pages/dashboard/billing.tsx:~169`, `example/convex/actions.ts`

Check `example/convex/actions.ts` for an existing `createBillingPortalSession` wrapper; add one if missing (mirror the file's other action wrappers calling `stripe.createBillingPortalSession(ctx, { stripeAccountId, returnUrl })`). In `billing.tsx`, replace the hard-coded `https://billing.stripe.com/p/login/test` link with the `BillingPortalLink` component using `onCreateSession` → the action (this also dog-foods Task 4.2). `pnpm typecheck:example`. Commit: `fix(example): create billing portal session via component action`

### Task 5.2: Remove `example/logs/` junk

```bash
git rm -r --cached example/logs/ 2>/dev/null; rm -rf example/logs
echo "logs/" >> example/.gitignore
```

Commit: `chore(example): drop stray log files, ignore logs/`

---

## Phase 6 — Documentation

### Task 6.1: README overhaul

**File:** `README.md`

1. **Package name:** every `better-stripe` install/import → `@getdojo/better-stripe` (lines 25, 40, 53, 91, 208, 260, 421, 540+, entry-points table at 655). Keep the *project title* as "better-stripe". `grep -n '"better-stripe' README.md` and `from "better-stripe` to find them all.
2. **Trigger contract (Quick Start step 2 + 3, Trigger API section):** update to the new reality — export the full dispatcher list from `triggersApi()`, and pass `triggers: internal.stripe as unknown as TriggerApiRefs` to `registerRoutes`. Update the `triggersApi()` wrapper-name tables/examples (old names like `onCheckoutSessionCompleted` → `checkoutSessionUpserted`, etc.). State explicitly: sync triggers run inside the dispatcher mutation (same transaction as the component write); async hooks are scheduled after the ledger marks the event processed.
3. **API version:** `2026-02-25.clover` → match `STRIPE_API_VERSION` in `src/client/constants.ts` (currently `2026-05-27.dahlia`) — line 599.
4. **Payment method params:** `stripeAccountId` → `stripeCustomerId` in the payment-method rows (lines 173-176) — verify against the actual method signatures in `src/client/connect/paymentMethods.ts`.
5. **`setDefaultPaymentMethod`:** add the V2 limitation note (throws; use billing portal).
6. **Supported events:** add `customer.subscription.trial_will_end`; update the event-count parentheticals near line 256 (verify by counting the arrays in `src/client/utils/webhookEndpoints.ts`).
7. **New APIs:** `getInvoice` row already exists (now true); `createAccountSession` row already exists (now true) — verify their documented signatures match what was built.

Re-read the final README Quick Start top-to-bottom and confirm every code block compiles conceptually against the actual exports. Commit: `docs: fix package name, trigger contract, and API drift in README`

### Task 6.2: CHANGELOG entry

**File:** `CHANGELOG.md` — follow the existing format. Entry under an `## Unreleased` heading summarizing: trigger system now wired (breaking change to `triggersApi()` export names + new `triggers` field on `registerRoutes`), new `getInvoice`/`createAccountSession`/`getPaymentByStripeId`, trial_will_end support, component index/validator improvements, react state fixes. Commit: `docs: changelog for audit fixes`

---

## Final verification (REQUIRED before claiming done)

```bash
pnpm test          # 261+ tests, all passing (count will grow)
pnpm typecheck     # lib + example clean
pnpm lint          # lib + example clean
pnpm build         # tsc build clean
```

All four must pass. Use superpowers:verification-before-completion before reporting.
