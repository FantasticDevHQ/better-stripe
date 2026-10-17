// @vitest-environment edge-runtime
import { expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import {
  componentsGeneric,
  defineSchema,
  defineTable,
  internalMutationGeneric,
  makeFunctionReference,
} from "convex/server";
import { v } from "convex/values";
import schema from "../../component/schema.js";
import { BetterStripe } from "../index.js";
import type { Component } from "../helpers.js";
import type { WebhookHandlerRefs } from "../types.js";
import { dispatchRefundReconciliation } from "./refundReconciliation.js";
import type { WebhookContext } from "./helpers.js";
import type { PreparedRefundSync } from "../connect/refundSync.js";

const component = componentsGeneric().betterStripe as unknown as Component;
const modules = import.meta.glob("../../component/**/*.*s");
const observationRef = makeFunctionReference<
  "mutation",
  { status: string; oldStatus?: string },
  null
>("refundHost:observe");

function fixture() {
  let isFailing = false;
  const handlers = new BetterStripe(component, {
    triggers: {
      refund: {
        onCreate: async (ctx, doc) => {
          await ctx.runMutation(observationRef, { status: doc.status });
          if (isFailing) throw new Error("Injected callback failure");
        },
        onUpdate: async (ctx, doc, old) => {
          await ctx.runMutation(observationRef, {
            status: doc.status,
            oldStatus: old.status,
          });
          if (isFailing) throw new Error("Injected callback failure");
        },
      },
    },
  }).webhookHandlers();
  const t = convexTest(
    defineSchema({
      observations: defineTable({
        status: v.string(),
        oldStatus: v.optional(v.string()),
      }),
    }),
    {
      "./_generated/server.ts": () =>
        import("../../component/_generated/server.js"),
      "./refundHost.ts": async () => ({
        ...handlers,
        observe: internalMutationGeneric({
          args: { status: v.string(), oldStatus: v.optional(v.string()) },
          returns: v.null(),
          handler: async (ctx, args) => {
            await ctx.db.insert("observations", args);
            return null;
          },
        }),
      }),
    },
  );
  t.registerComponent("betterStripe", schema, modules);
  const syncWebhook = makeFunctionReference<"mutation">(
    "refundHost:syncWebhook",
  ) as unknown as WebhookHandlerRefs["syncWebhook"];
  const refund = {
    stripeRefundId: "re_original",
    stripePaymentIntentId: "pi_original",
    stripeChargeId: "ch_original",
    amount: 250,
    currency: "usd",
    status: "succeeded" as const,
    metadata: { betterStripeRefundCommand: "original-command" },
  };
  const prepare = async (
    status: PreparedRefundSync["refund"]["status"] = "succeeded",
  ): Promise<PreparedRefundSync> => ({
    stripeRefundId: refund.stripeRefundId,
    apiContext: "platform",
    generation: await t.mutation(component.refundSync.mutations.begin, {
      stripeRefundId: refund.stripeRefundId,
      apiContext: "platform",
    }),
    refund: { ...refund, status },
  });
  const accept = (data: Awaited<ReturnType<typeof prepare>>) =>
    t.mutation(syncWebhook, { dispatcher: "refundReconciled", data });
  const observations = () =>
    t.run((ctx) => ctx.db.query("observations").collect());
  return {
    t,
    syncWebhook,
    refund,
    prepare,
    accept,
    observations,
    fail: (value: boolean) => {
      isFailing = value;
    },
  };
}

it("control: retains legacy raw refund dispatcher behavior", async () => {
  const f = fixture();
  expect(
    await f.t.mutation(f.syncWebhook, {
      dispatcher: "refundUpserted",
      data: f.refund,
    }),
  ).toBeNull();
  expect(
    await f.t.run((ctx) => ctx.db.query("observations").collect()),
  ).toMatchObject([{ status: "succeeded" }]);
});

it("returns the qualified accepting result and commits its callback together", async () => {
  const f = fixture();
  const generation = await f.t.mutation(component.refundSync.mutations.begin, {
    stripeRefundId: f.refund.stripeRefundId,
    apiContext: "platform",
  });
  const result = await f.t.mutation(f.syncWebhook, {
    dispatcher: "refundReconciled",
    data: {
      stripeRefundId: f.refund.stripeRefundId,
      apiContext: "platform",
      generation,
      refund: f.refund,
    },
  });
  expect(result).toMatchObject({
    status: "accepted",
    generation,
    changed: true,
    refund: { stripeRefundId: "re_original", status: "succeeded" },
  });
  expect(
    await f.t.run((ctx) => ctx.db.query("observations").collect()),
  ).toMatchObject([{ status: "succeeded" }]);
});

it("rolls back callback, accepting claim, mirrored refund and cumulative payment together", async () => {
  const f = fixture();
  await f.t.mutation(component.connect.mutations.upsertPayment, {
    stripePaymentIntentId: "pi_original",
    userId: "buyer",
    amount: 1000,
    currency: "usd",
    status: "succeeded",
  });
  await f.t.mutation(component.connect.mutations.upsertRefund, {
    ...f.refund,
    status: "failed",
  });
  const prepared = await f.prepare();
  f.fail(true);
  await expect(f.accept(prepared)).rejects.toThrow("Injected callback failure");
  expect(await f.observations()).toEqual([]);
  expect(
    await f.t.query(component.connect.queries.getRefundByStripeId, {
      stripeRefundId: "re_original",
    }),
  ).toMatchObject({ status: "failed" });
  expect(
    await f.t.query(component.connect.queries.getPaymentByStripeId, {
      stripePaymentIntentId: "pi_original",
    }),
  ).toMatchObject({ refundedAmount: 0 });
  f.fail(false);
  // A rolled-back accepting claim must still permit its first changed acceptance.
  expect(await f.accept(prepared)).toMatchObject({
    status: "accepted",
    changed: true,
  });
  expect(await f.observations()).toMatchObject([
    { status: "succeeded", oldStatus: "failed" },
  ]);
  expect(
    await f.t.query(component.connect.queries.getPaymentByStripeId, {
      stripePaymentIntentId: "pi_original",
    }),
  ).toMatchObject({ refundedAmount: 250 });
});

it("returns unchanged accepted observations without repeating callbacks", async () => {
  const f = fixture();
  const prepared = await f.prepare();
  await f.accept(prepared);
  expect(await f.accept(prepared)).toMatchObject({
    status: "accepted",
    changed: false,
  });
  expect(await f.accept(await f.prepare())).toMatchObject({
    status: "accepted",
    changed: false,
  });
  expect(await f.observations()).toHaveLength(1);
  expect(await f.accept(await f.prepare("requires_action"))).toMatchObject({
    status: "accepted",
    changed: true,
  });
  expect(await f.observations()).toMatchObject([
    { status: "succeeded" },
    { status: "requires_action", oldStatus: "succeeded" },
  ]);
});

it("rejects superseded callbacks even when the newer observation has not committed", async () => {
  const f = fixture();
  const old = await f.prepare();
  const current = await f.prepare("requires_action");
  await expect(f.accept(old)).rejects.toThrow(
    "Current refund observation is unavailable",
  );
  expect(await f.observations()).toEqual([]);
  await f.accept(current);
  await expect(f.accept(old)).rejects.toThrow(
    "Current refund observation is unavailable",
  );
  expect(await f.observations()).toMatchObject([{ status: "requires_action" }]);
});

it("preserves accepting results and superseded failure in the direct fallback", async () => {
  const f = fixture();
  const context = {
    component,
    ctx: { runMutation: f.t.mutation, runQuery: f.t.query },
  } as unknown as WebhookContext;
  const old = await f.prepare();
  const current = await f.prepare();
  await expect(dispatchRefundReconciliation(context, old)).rejects.toThrow(
    "Current refund observation is unavailable",
  );
  expect(await dispatchRefundReconciliation(context, current)).toMatchObject({
    status: "accepted",
    changed: true,
  });
  expect(await dispatchRefundReconciliation(context, current)).toMatchObject({
    status: "accepted",
    changed: false,
  });
  expect(await f.observations()).toEqual([]);
});

it("returns the actual registered host result without a later raw upsert", async () => {
  const f = fixture();
  const runMutation = vi.fn(f.t.mutation);
  const context = {
    component,
    ctx: { runMutation, runQuery: f.t.query },
    config: { webhooks: { syncWebhook: f.syncWebhook } },
  } as unknown as WebhookContext;
  const prepared = await f.prepare();
  expect(await dispatchRefundReconciliation(context, prepared)).toMatchObject({
    status: "accepted",
    changed: true,
  });
  expect(runMutation).toHaveBeenCalledTimes(1);
  expect(await f.observations()).toMatchObject([{ status: "succeeded" }]);
});

it("holds a legacy null-returning host instead of silently using a raw fallback", async () => {
  const f = fixture();
  const runMutation = vi.fn(async () => null);
  const context = {
    component,
    ctx: { runMutation },
    config: { webhooks: { syncWebhook: f.syncWebhook } },
  } as unknown as WebhookContext;
  await expect(
    dispatchRefundReconciliation(context, await f.prepare()),
  ).rejects.toThrow("Current refund observation is unavailable");
  expect(runMutation).toHaveBeenCalledTimes(1);
  expect(
    await f.t.query(component.connect.queries.getRefundByStripeId, {
      stripeRefundId: "re_original",
    }),
  ).toBeNull();
  expect(await f.observations()).toEqual([]);
});

it("holds mismatched API context without a callback or accepting write", async () => {
  const f = fixture();
  const prepared = await f.prepare();
  await expect(
    f.accept({ ...prepared, apiContext: "acct_foreign" }),
  ).rejects.toThrow("API context does not match");
  expect(await f.observations()).toEqual([]);
  expect(
    await f.t.query(component.connect.queries.getRefundByStripeId, {
      stripeRefundId: "re_original",
    }),
  ).toBeNull();
  expect(await f.accept(prepared)).toMatchObject({
    status: "accepted",
    changed: true,
  });
});
