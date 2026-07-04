// @vitest-environment edge-runtime
/**
 * Tests for `BetterStripe.webhookHandlers()` — the two-function routing pair
 * (`syncWebhook` / `asyncWebhook`) that replaced the 18-export `triggersApi()`.
 *
 * The routing mutation/action are invoked the same way the webhook handler
 * invokes them: by their discriminator arg (`dispatcher` / `hook`). Registered
 * Convex functions expose their raw handler via `_handler`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BetterStripe } from "./index.js";
import { components as _components } from "./setup.test.js";
import type { SyncTriggers, TriggerDispatcherName } from "./types/triggers.js";

const components = _components;

// Registered Convex functions expose their raw handler via `_handler`
// (set by convex/server's registration impl) — invoke the routing functions
// that way.
const invokeHandler = (fn: unknown, ctx: unknown, args: unknown) =>
  (fn as { _handler: (ctx: unknown, args: unknown) => Promise<null> })._handler(
    ctx,
    args,
  );

// Component refs expose their function path via the toReferencePath symbol
// (e.g. "_reference/childComponent/betterStripe/billing/..."). Asserting on
// the path suffix catches typo'd dispatcher spec paths.
const refPath = (ref: unknown): string =>
  (ref as Record<symbol, string>)[Symbol.for("toReferencePath")];

function createMockCtx() {
  return {
    runQuery: vi.fn(),
    runMutation: vi.fn(),
    runAction: vi.fn(),
  };
}

describe("webhookHandlers()", () => {
  let mockCtx: ReturnType<typeof createMockCtx>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx = createMockCtx();
  });

  it("returns syncWebhook + asyncWebhook function definitions", () => {
    const stripe = new BetterStripe(components.betterStripe, {
      STRIPE_SECRET_KEY: "sk_test_x",
    });
    const handlers = stripe.webhookHandlers();
    expect(handlers).toHaveProperty("syncWebhook");
    expect(handlers).toHaveProperty("asyncWebhook");
    expect(Object.keys(handlers)).toHaveLength(2);
  });

  // =========================================================================
  // syncWebhook routing
  // =========================================================================

  describe("syncWebhook", () => {
    // Standard upsert dispatchers: each maps to a component getter/upsert pair
    // and supports the splitCreateUpdate create/update trigger split.
    const standardUpsertDispatchers: Array<{
      name: TriggerDispatcherName;
      triggerKey: keyof SyncTriggers;
      idField: string;
      getterPath: RegExp;
      upsertPath: RegExp;
      hasUpdate: boolean;
    }> = [
      {
        name: "accountUpserted",
        triggerKey: "account",
        idField: "stripeAccountId",
        getterPath: /\/core\/queries\/getAccountByStripeId$/,
        upsertPath: /\/core\/mutations\/upsertAccountInternal$/,
        hasUpdate: true,
      },
      {
        name: "productUpserted",
        triggerKey: "product",
        idField: "stripeProductId",
        getterPath: /\/products\/queries\/getProductByStripeId$/,
        upsertPath: /\/products\/mutations\/upsertProduct$/,
        hasUpdate: true,
      },
      {
        name: "priceUpserted",
        triggerKey: "price",
        idField: "stripePriceId",
        getterPath: /\/products\/queries\/getPriceByStripeId$/,
        upsertPath: /\/products\/mutations\/upsertPrice$/,
        hasUpdate: true,
      },
      {
        name: "subscriptionUpserted",
        triggerKey: "subscription",
        idField: "stripeSubscriptionId",
        getterPath: /\/billing\/queries\/getSubscriptionByStripeId$/,
        upsertPath: /\/billing\/mutations\/upsertSubscription$/,
        hasUpdate: true,
      },
      {
        name: "invoiceUpserted",
        triggerKey: "invoice",
        idField: "stripeInvoiceId",
        getterPath: /\/billing\/queries\/getInvoiceByStripeId$/,
        upsertPath: /\/billing\/mutations\/upsertInvoice$/,
        hasUpdate: true,
      },
      {
        name: "paymentUpserted",
        triggerKey: "payment",
        idField: "stripePaymentIntentId",
        getterPath: /\/connect\/queries\/getPaymentByStripeId$/,
        upsertPath: /\/connect\/mutations\/upsertPayment$/,
        hasUpdate: false,
      },
      {
        name: "payoutUpserted",
        triggerKey: "payout",
        idField: "stripePayoutId",
        getterPath: /\/connect\/queries\/getPayoutByStripeId$/,
        upsertPath: /\/connect\/mutations\/upsertPayout$/,
        hasUpdate: true,
      },
      {
        name: "refundUpserted",
        triggerKey: "refund",
        idField: "stripeRefundId",
        getterPath: /\/connect\/queries\/getRefundByStripeId$/,
        upsertPath: /\/connect\/mutations\/upsertRefund$/,
        hasUpdate: true,
      },
      {
        name: "disputeUpserted",
        triggerKey: "dispute",
        idField: "stripeDisputeId",
        getterPath: /\/connect\/queries\/getDisputeByStripeId$/,
        upsertPath: /\/connect\/mutations\/upsertDispute$/,
        hasUpdate: true,
      },
    ];

    describe("standard upsert dispatchers", () => {
      it.each(standardUpsertDispatchers)(
        "$name upserts and fires onCreate for a new doc, in one transaction",
        async ({
          name,
          triggerKey,
          idField,
          getterPath,
          upsertPath,
          hasUpdate,
        }) => {
          const onCreate = vi.fn().mockResolvedValue(undefined);
          const onUpdate = hasUpdate
            ? vi.fn().mockResolvedValue(undefined)
            : undefined;
          const bs = new BetterStripe(components.betterStripe, {
            STRIPE_SECRET_KEY: "sk_test_xxx",
            triggers: { [triggerKey]: { onCreate, onUpdate } } as SyncTriggers,
          });

          const newDoc = { [idField]: "id_1", status: "active" };
          mockCtx.runQuery
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(newDoc);

          const { syncWebhook } = bs.webhookHandlers();
          await invokeHandler(syncWebhook, mockCtx, {
            dispatcher: name,
            data: newDoc,
          });

          expect(mockCtx.runMutation).toHaveBeenCalledTimes(1);
          const [upsertRef, upsertArgs] = mockCtx.runMutation.mock.calls[0];
          expect(refPath(upsertRef)).toMatch(upsertPath);
          expect(upsertArgs).toEqual(newDoc);

          expect(mockCtx.runQuery).toHaveBeenCalledTimes(2);
          for (const [getterRef, getterArgs] of mockCtx.runQuery.mock.calls) {
            expect(refPath(getterRef)).toMatch(getterPath);
            expect(getterArgs).toEqual({ [idField]: "id_1" });
          }

          expect(onCreate).toHaveBeenCalledTimes(1);
          expect(onCreate).toHaveBeenCalledWith(mockCtx, newDoc);
          if (hasUpdate) {
            expect(onUpdate).not.toHaveBeenCalled();
          }
        },
      );

      it.each(standardUpsertDispatchers)(
        "$name fires the update trigger (not onCreate) for an existing doc",
        async ({
          name,
          triggerKey,
          idField,
          getterPath,
          upsertPath,
          hasUpdate,
        }) => {
          const onCreate = vi.fn().mockResolvedValue(undefined);
          const onUpdate = hasUpdate
            ? vi.fn().mockResolvedValue(undefined)
            : undefined;
          const bs = new BetterStripe(components.betterStripe, {
            STRIPE_SECRET_KEY: "sk_test_xxx",
            triggers: { [triggerKey]: { onCreate, onUpdate } } as SyncTriggers,
          });

          const oldDoc = { [idField]: "id_1", status: "old" };
          const newDoc = { [idField]: "id_1", status: "new" };
          mockCtx.runQuery
            .mockResolvedValueOnce(oldDoc)
            .mockResolvedValueOnce(newDoc);

          const { syncWebhook } = bs.webhookHandlers();
          await invokeHandler(syncWebhook, mockCtx, {
            dispatcher: name,
            data: newDoc,
          });

          expect(mockCtx.runMutation).toHaveBeenCalledTimes(1);
          const [upsertRef, upsertArgs] = mockCtx.runMutation.mock.calls[0];
          expect(refPath(upsertRef)).toMatch(upsertPath);
          expect(upsertArgs).toEqual(newDoc);

          expect(mockCtx.runQuery).toHaveBeenCalledTimes(2);
          for (const [getterRef, getterArgs] of mockCtx.runQuery.mock.calls) {
            expect(refPath(getterRef)).toMatch(getterPath);
            expect(getterArgs).toEqual({ [idField]: "id_1" });
          }

          expect(onCreate).not.toHaveBeenCalled();
          if (hasUpdate) {
            expect(onUpdate).toHaveBeenCalledTimes(1);
            expect(onUpdate).toHaveBeenCalledWith(mockCtx, newDoc, oldDoc);
          }
        },
      );
    });

    it("subscriptionUpserted upserts and fires onCreate for a new doc, in one transaction", async () => {
      const onCreate = vi.fn().mockResolvedValue(undefined);
      const onUpdate = vi.fn().mockResolvedValue(undefined);
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
        triggers: { subscription: { onCreate, onUpdate } },
      });

      const newDoc = { stripeSubscriptionId: "sub_1", status: "active" };
      mockCtx.runQuery
        .mockResolvedValueOnce(null) // old doc lookup
        .mockResolvedValueOnce(newDoc); // new doc lookup

      const { syncWebhook } = bs.webhookHandlers();
      await invokeHandler(syncWebhook, mockCtx, {
        dispatcher: "subscriptionUpserted",
        data: { stripeSubscriptionId: "sub_1", status: "active" },
      });

      // Component upsert performed exactly once, against the right function.
      expect(mockCtx.runMutation).toHaveBeenCalledTimes(1);
      const [upsertRef, upsertArgs] = mockCtx.runMutation.mock.calls[0];
      expect(refPath(upsertRef)).toMatch(
        /\/billing\/mutations\/upsertSubscription$/,
      );
      expect(upsertArgs).toEqual({
        stripeSubscriptionId: "sub_1",
        status: "active",
      });
      // Both doc lookups hit the getter with the Stripe id from data.
      expect(mockCtx.runQuery).toHaveBeenCalledTimes(2);
      for (const [getterRef, getterArgs] of mockCtx.runQuery.mock.calls) {
        expect(refPath(getterRef)).toMatch(
          /\/billing\/queries\/getSubscriptionByStripeId$/,
        );
        expect(getterArgs).toEqual({ stripeSubscriptionId: "sub_1" });
      }
      // The sync trigger ran inside the same handler invocation (same txn).
      expect(onCreate).toHaveBeenCalledTimes(1);
      expect(onCreate).toHaveBeenCalledWith(mockCtx, newDoc);
      expect(onUpdate).not.toHaveBeenCalled();
    });

    it("subscriptionUpserted fires onUpdate (not onCreate) for an existing doc", async () => {
      const onCreate = vi.fn().mockResolvedValue(undefined);
      const onUpdate = vi.fn().mockResolvedValue(undefined);
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
        triggers: { subscription: { onCreate, onUpdate } },
      });

      const oldDoc = { stripeSubscriptionId: "sub_1", status: "trialing" };
      const newDoc = { stripeSubscriptionId: "sub_1", status: "active" };
      mockCtx.runQuery
        .mockResolvedValueOnce(oldDoc)
        .mockResolvedValueOnce(newDoc);

      const { syncWebhook } = bs.webhookHandlers();
      await invokeHandler(syncWebhook, mockCtx, {
        dispatcher: "subscriptionUpserted",
        data: { stripeSubscriptionId: "sub_1", status: "active" },
      });

      expect(mockCtx.runMutation).toHaveBeenCalledTimes(1);
      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect(onUpdate).toHaveBeenCalledWith(mockCtx, newDoc, oldDoc);
      expect(onCreate).not.toHaveBeenCalled();
    });

    it("propagates a throwing sync trigger (so the upsert transaction rolls back)", async () => {
      const onUpdate = vi.fn().mockRejectedValue(new Error("trigger boom"));
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
        triggers: { subscription: { onUpdate } },
      });
      const { syncWebhook } = bs.webhookHandlers();

      const oldDoc = { stripeSubscriptionId: "sub_1", status: "active" };
      const newDoc = { stripeSubscriptionId: "sub_1", status: "past_due" };
      mockCtx.runQuery
        .mockResolvedValueOnce(oldDoc)
        .mockResolvedValueOnce(newDoc);

      // The throw must propagate out of the routing mutation. In a real Convex
      // mutation this aborts the transaction, rolling back the component upsert
      // — the contract that makes Stripe retry the webhook.
      await expect(
        invokeHandler(syncWebhook, mockCtx, {
          dispatcher: "subscriptionUpserted",
          data: { stripeSubscriptionId: "sub_1", status: "past_due" },
        }),
      ).rejects.toThrow("trigger boom");
      expect(onUpdate).toHaveBeenCalledTimes(1);
    });

    it("checkoutSessionUpserted fires onCompleted on transition into 'complete'", async () => {
      const onCompleted = vi.fn().mockResolvedValue(undefined);
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
        triggers: { checkoutSession: { onCompleted } },
      });
      const { syncWebhook } = bs.webhookHandlers();

      const newDoc = { stripeSessionId: "cs_1", status: "complete" };
      mockCtx.runQuery
        .mockResolvedValueOnce({ stripeSessionId: "cs_1", status: "open" })
        .mockResolvedValueOnce(newDoc);

      await invokeHandler(syncWebhook, mockCtx, {
        dispatcher: "checkoutSessionUpserted",
        data: { stripeSessionId: "cs_1", status: "complete" },
      });

      expect(mockCtx.runMutation).toHaveBeenCalledTimes(1);
      expect(refPath(mockCtx.runMutation.mock.calls[0][0])).toMatch(
        /\/billing\/mutations\/upsertCheckoutSession$/,
      );
      expect(refPath(mockCtx.runQuery.mock.calls[0][0])).toMatch(
        /\/billing\/queries\/getCheckoutSessionByStripeId$/,
      );
      expect(onCompleted).toHaveBeenCalledTimes(1);
      expect(onCompleted).toHaveBeenCalledWith(mockCtx, newDoc);
    });

    it("checkoutSessionUpserted fires onCompleted when first seen already complete (null -> complete)", async () => {
      const onCompleted = vi.fn().mockResolvedValue(undefined);
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
        triggers: { checkoutSession: { onCompleted } },
      });
      const { syncWebhook } = bs.webhookHandlers();

      const newDoc = { stripeSessionId: "cs_1", status: "complete" };
      mockCtx.runQuery
        .mockResolvedValueOnce(null) // no prior doc
        .mockResolvedValueOnce(newDoc);

      await invokeHandler(syncWebhook, mockCtx, {
        dispatcher: "checkoutSessionUpserted",
        data: { stripeSessionId: "cs_1", status: "complete" },
      });

      expect(mockCtx.runMutation).toHaveBeenCalledTimes(1);
      expect(onCompleted).toHaveBeenCalledTimes(1);
      expect(onCompleted).toHaveBeenCalledWith(mockCtx, newDoc);
    });

    it("checkoutSessionUpserted does NOT re-fire onCompleted when already complete", async () => {
      const onCompleted = vi.fn().mockResolvedValue(undefined);
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
        triggers: { checkoutSession: { onCompleted } },
      });
      const { syncWebhook } = bs.webhookHandlers();

      mockCtx.runQuery
        .mockResolvedValueOnce({ stripeSessionId: "cs_1", status: "complete" })
        .mockResolvedValueOnce({ stripeSessionId: "cs_1", status: "complete" });

      await invokeHandler(syncWebhook, mockCtx, {
        dispatcher: "checkoutSessionUpserted",
        data: { stripeSessionId: "cs_1", status: "complete" },
      });

      expect(mockCtx.runMutation).toHaveBeenCalledTimes(1);
      expect(onCompleted).not.toHaveBeenCalled();
    });

    it("checkoutSessionUpserted does NOT fire onCompleted when new status is not 'complete'", async () => {
      const onCompleted = vi.fn().mockResolvedValue(undefined);
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
        triggers: { checkoutSession: { onCompleted } },
      });
      const { syncWebhook } = bs.webhookHandlers();

      mockCtx.runQuery
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ stripeSessionId: "cs_1", status: "open" });

      await invokeHandler(syncWebhook, mockCtx, {
        dispatcher: "checkoutSessionUpserted",
        data: { stripeSessionId: "cs_1", status: "open" },
      });

      expect(mockCtx.runMutation).toHaveBeenCalledTimes(1);
      expect(onCompleted).not.toHaveBeenCalled();
    });

    it("subscriptionDeleted upserts and fires subscription.onDelete with the fetched doc", async () => {
      const onDelete = vi.fn().mockResolvedValue(undefined);
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
        triggers: { subscription: { onDelete } },
      });
      const { syncWebhook } = bs.webhookHandlers();

      const doc = { stripeSubscriptionId: "sub_1", status: "canceled" };
      mockCtx.runQuery.mockResolvedValueOnce(doc);

      await invokeHandler(syncWebhook, mockCtx, {
        dispatcher: "subscriptionDeleted",
        data: { stripeSubscriptionId: "sub_1", status: "canceled" },
      });

      expect(mockCtx.runMutation).toHaveBeenCalledTimes(1);
      const [upsertRef, upsertArgs] = mockCtx.runMutation.mock.calls[0];
      expect(refPath(upsertRef)).toMatch(
        /\/billing\/mutations\/upsertSubscription$/,
      );
      expect(upsertArgs).toEqual({
        stripeSubscriptionId: "sub_1",
        status: "canceled",
      });
      const [getterRef, getterArgs] = mockCtx.runQuery.mock.calls[0];
      expect(refPath(getterRef)).toMatch(
        /\/billing\/queries\/getSubscriptionByStripeId$/,
      );
      expect(getterArgs).toEqual({ stripeSubscriptionId: "sub_1" });
      expect(onDelete).toHaveBeenCalledTimes(1);
      expect(onDelete).toHaveBeenCalledWith(mockCtx, doc);
    });

    it("rejects with a clear error when the Stripe id field is missing from data", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
        triggers: { subscription: { onCreate: vi.fn() } },
      });
      const { syncWebhook } = bs.webhookHandlers();

      await expect(
        invokeHandler(syncWebhook, mockCtx, {
          dispatcher: "subscriptionUpserted",
          data: { status: "active" },
        }),
      ).rejects.toThrow(
        "[better-stripe] subscriptionUpserted: missing stripeSubscriptionId in data",
      );

      // Nothing was written or read.
      expect(mockCtx.runMutation).not.toHaveBeenCalled();
      expect(mockCtx.runQuery).not.toHaveBeenCalled();
    });

    it("rejects with a clear error for an unknown dispatcher", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });
      const { syncWebhook } = bs.webhookHandlers();

      await expect(
        invokeHandler(syncWebhook, mockCtx, {
          dispatcher: "bogusDispatcher",
          data: { stripeSubscriptionId: "sub_1" },
        }),
      ).rejects.toThrow("[better-stripe] unknown dispatcher: bogusDispatcher");
      expect(mockCtx.runMutation).not.toHaveBeenCalled();
    });

    it("propagates trigger errors so the transaction rolls back", async () => {
      const onCreate = vi.fn().mockRejectedValue(new Error("trigger boom"));
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
        triggers: { subscription: { onCreate } },
      });
      const { syncWebhook } = bs.webhookHandlers();

      mockCtx.runQuery
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ stripeSubscriptionId: "sub_1" });

      // The upsert ran, then the trigger threw. Because both run in the same
      // mutation handler, a throw aborts the whole invocation — Convex rolls
      // back the upsert. We assert the handler rejects (the rollback signal).
      await expect(
        invokeHandler(syncWebhook, mockCtx, {
          dispatcher: "subscriptionUpserted",
          data: { stripeSubscriptionId: "sub_1" },
        }),
      ).rejects.toThrow("trigger boom");
      expect(mockCtx.runMutation).toHaveBeenCalledTimes(1);
    });

    it("performs the upsert without throwing when no triggers are configured", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });
      const { syncWebhook } = bs.webhookHandlers();

      await expect(
        invokeHandler(syncWebhook, mockCtx, {
          dispatcher: "subscriptionUpserted",
          data: { stripeSubscriptionId: "sub_1" },
        }),
      ).resolves.toBeNull();

      expect(mockCtx.runMutation).toHaveBeenCalledTimes(1);
      // No trigger configured -> the before/after doc reads are skipped.
      expect(mockCtx.runQuery).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // asyncWebhook routing
  // =========================================================================

  describe("asyncWebhook", () => {
    it("routes to the configured hook with (ctx, doc)", async () => {
      const onCheckoutCompleted = vi.fn().mockResolvedValue(undefined);
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
        hooks: { onCheckoutCompleted },
      });
      const { asyncWebhook } = bs.webhookHandlers();

      const doc = { stripeSessionId: "cs_1", status: "complete" };
      await invokeHandler(asyncWebhook, mockCtx, {
        hook: "afterCheckoutCompleted",
        doc,
      });

      expect(onCheckoutCompleted).toHaveBeenCalledTimes(1);
      expect(onCheckoutCompleted).toHaveBeenCalledWith(mockCtx, doc);
    });

    it("resolves without error when no hook is configured", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });
      const { asyncWebhook } = bs.webhookHandlers();

      await expect(
        invokeHandler(asyncWebhook, mockCtx, {
          hook: "afterCheckoutCompleted",
          doc: { stripeSessionId: "cs_1" },
        }),
      ).resolves.toBeNull();
    });

    it("resolves without error for an unknown hook name", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
        hooks: { onCheckoutCompleted: vi.fn() },
      });
      const { asyncWebhook } = bs.webhookHandlers();

      await expect(
        invokeHandler(asyncWebhook, mockCtx, {
          hook: "bogusHook",
          doc: {},
        }),
      ).resolves.toBeNull();
    });
  });
});
