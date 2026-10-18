// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import {
  componentsGeneric,
  defineSchema,
  defineTable,
  httpRouter,
  internalMutationGeneric,
  makeFunctionReference,
} from "convex/server";
import { v } from "convex/values";
import Stripe from "stripe";
import { expect, it } from "vitest";

import { mutation } from "../../component/_generated/server.js";
import schema from "../../component/schema.js";
import { BetterStripe, registerRoutes } from "../index.js";
import type { Component } from "../helpers.js";
import type {
  StripeComponentSubscription,
  SyncTriggerCtx,
  WebhookHandlerRefs,
} from "../types.js";

const component = componentsGeneric().betterStripe as unknown as Component;
const modules = import.meta.glob("../../component/**/*.*s");
const secret = "whsec_synthetic_previous_subscription";
const observeRef = makeFunctionReference<
  "mutation",
  {
    current: StripeComponentSubscription;
    previous?: StripeComponentSubscription | null;
  },
  string[]
>("subscriptionHost:observe");
const duplicate = mutation({
  args: { stripeSubscriptionId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_subscription_id", (q) =>
        q.eq("stripeSubscriptionId", args.stripeSubscriptionId),
      )
      .first();
    if (!row) throw new Error("Missing original subscription");
    const { _id, _creationTime, ...fields } = row;
    await ctx.db.insert("subscriptions", fields);
    return null;
  },
});

async function fixture(
  options: {
    isLegacy?: boolean;
    isRegistered?: boolean;
    hasOriginal?: boolean;
    hasCallback?: boolean;
  } = {},
) {
  let hasCallbackFailure = false;
  const attemptedScopes: string[] = [];
  const observe = async (
    ctx: SyncTriggerCtx,
    doc: StripeComponentSubscription,
    ...previous: unknown[]
  ) => {
    const oldDoc = previous[0] as
      StripeComponentSubscription | null | undefined;
    attemptedScopes.push(
      ...(await ctx.runMutation(observeRef, {
        current: doc,
        ...(oldDoc === undefined ? {} : { previous: oldDoc }),
      })),
    );
    if (hasCallbackFailure) throw new Error("Later host transaction failure");
  };
  // A two-argument callback remains a valid supported consumer.
  const legacy = async (
    ctx: SyncTriggerCtx,
    doc: StripeComponentSubscription,
  ) => observe(ctx, doc);
  const sdk = new BetterStripe(component, {
    STRIPE_SECRET_KEY: "sk_test_previous_subscription",
    triggers:
      options.hasCallback === false
        ? {}
        : {
            subscription: { onDelete: options.isLegacy ? legacy : observe },
          },
  });
  const http = httpRouter();
  registerRoutes(http, component, {
    stripeSecretKey: "sk_test_previous_subscription",
    webhookSecret: secret,
    ...(options.isRegistered === false
      ? {}
      : {
          webhooks: {
            syncWebhook: makeFunctionReference("subscriptionHost:syncWebhook"),
            asyncWebhook: makeFunctionReference(
              "subscriptionHost:asyncWebhook",
            ),
          } as unknown as WebhookHandlerRefs,
        }),
  });
  const t = convexTest(
    defineSchema({
      observations: defineTable({
        current: v.any(),
        previous: v.optional(v.any()),
      }),
      holds: defineTable({ scope: v.string() }),
    }),
    {
      "./_generated/server.ts": () =>
        import("../../component/_generated/server.js"),
      "./http.ts": async () => ({ default: http }),
      "./subscriptionHost.ts": async () => ({
        ...sdk.webhookHandlers(),
        observe: internalMutationGeneric({
          args: { current: v.any(), previous: v.optional(v.any()) },
          returns: v.array(v.string()),
          handler: async (ctx, args) => {
            await ctx.db.insert("observations", args);
            const scopes: string[] = [];
            for (const doc of [args.previous, args.current]) {
              const scope: unknown = doc?.metadata?.communityId;
              if (typeof scope === "string") {
                await ctx.db.insert("holds", { scope });
                scopes.push(scope);
              }
            }
            return scopes;
          },
        }),
      }),
    },
  );
  t.registerComponent("betterStripe", schema, {
    ...Object.fromEntries(
      Object.entries(modules).map(([path, loader]) => [
        path.split("/component/")[1]!,
        loader,
      ]),
    ),
    "qa/subscriptionDuplicates.ts": async () => ({ duplicate }),
  });
  const original = {
    stripeSubscriptionId: "sub_previous_identity",
    accountId: "acct_previous",
    userId: "original-buyer",
    orgId: "original-org",
    priceId: "price_original",
    status: "active" as const,
    cancelAtPeriodEnd: false,
    isTrialing: false,
    metadata: {
      communityId: "old-metadata-only-community",
      userId: "original-buyer",
    },
  };
  if (options.hasOriginal !== false)
    await t.mutation(component.billing.mutations.upsertSubscription, original);
  const row = () =>
    t.query(component.billing.queries.getSubscriptionByStripeId, {
      stripeSubscriptionId: original.stripeSubscriptionId,
      requireUnique: true,
    });
  const send = async (isValid = true) => {
    const body = JSON.stringify({
      id: "evt_previous_subscription_deleted",
      object: "event",
      type: "customer.subscription.deleted",
      livemode: false,
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: original.stripeSubscriptionId,
          object: "subscription",
          customer_account: "acct_replacement",
          status: "canceled",
          cancel_at_period_end: false,
          canceled_at: 1700000000,
          metadata: {
            communityId: "new-metadata-only-community",
            userId: "new-buyer",
          },
          items: {
            data: [{ price: { id: "price_replacement" }, quantity: 1 }],
          },
        },
      },
    });
    const signature = await Stripe.webhooks.generateTestHeaderStringAsync({
      payload: body,
      secret,
    });
    return t.fetch("/stripe/webhook", {
      method: "POST",
      body,
      headers: { "stripe-signature": isValid ? signature : "t=0,v1=invalid" },
    });
  };
  return {
    t,
    sdk,
    original,
    row,
    send,
    attemptedScopes,
    observations: () => t.run((ctx) => ctx.db.query("observations").collect()),
    holds: () => t.run((ctx) => ctx.db.query("holds").collect()),
    failCallback: () => {
      hasCallbackFailure = true;
    },
    duplicate: () =>
      t.mutation(
        componentsGeneric().betterStripe.qa.subscriptionDuplicates.duplicate,
        {
          stripeSubscriptionId: original.stripeSubscriptionId,
        },
      ),
  };
}

it("passes exact previous and resulting documents through the signed registered delete endpoint", async () => {
  const f = await fixture();
  const previous = await f.row();
  expect(previous).not.toBeNull();
  expect((await f.send()).status).toBe(200);
  const current = await f.row();
  expect(current).toMatchObject({
    status: "canceled",
    userId: "new-buyer",
    accountId: "acct_replacement",
    priceId: "price_replacement",
  });
  expect(await f.observations()).toMatchObject([{ previous, current }]);
  expect((await f.holds()).map((hold) => hold.scope).sort()).toEqual([
    "new-metadata-only-community",
    "old-metadata-only-community",
  ]);
});

it("rolls back the mirror and both host holds when a later synchronous callback fails", async () => {
  const f = await fixture();
  const previous = await f.row();
  f.failCallback();
  expect((await f.send()).status).toBe(500);
  expect(f.attemptedScopes.sort()).toEqual([
    "new-metadata-only-community",
    "old-metadata-only-community",
  ]);
  expect(await f.row()).toEqual(previous);
  expect(await f.observations()).toEqual([]);
  expect(await f.holds()).toEqual([]);
});

it("rejects actual duplicate cached identities before destructive upsert or a callback", async () => {
  const f = await fixture();
  await f.duplicate();
  expect(await f.row()).toBeNull();
  const before = await f.t.query(
    component.billing.queries.listSubscriptions,
    {},
  );
  expect(before).toHaveLength(2);
  expect((await f.send()).status).toBe(500);
  expect(
    await f.t.query(component.billing.queries.listSubscriptions, {}),
  ).toEqual(before);
  expect(await f.observations()).toEqual([]);
  expect(await f.holds()).toEqual([]);
});

it("supplies explicit null for an absent previous identity", async () => {
  const f = await fixture({ hasOriginal: false });
  expect((await f.send()).status).toBe(200);
  expect(await f.observations()).toMatchObject([
    { previous: null, current: { status: "canceled" } },
  ]);
});

it("retains a two-argument synchronous delete callback", async () => {
  const f = await fixture({ isLegacy: true });
  expect((await f.send()).status).toBe(200);
  expect(await f.observations()).toMatchObject([
    { current: { status: "canceled" } },
  ]);
});

it("retains ordinary cancellation mirror writes without a registered host dispatcher", async () => {
  const f = await fixture({ isRegistered: false });
  expect((await f.send()).status).toBe(200);
  expect(await f.row()).toMatchObject({ status: "canceled" });
  expect(await f.observations()).toEqual([]);
});

it("retains the registered dispatcher mirror when no delete callback is configured", async () => {
  const f = await fixture({ hasCallback: false });
  expect((await f.send()).status).toBe(200);
  expect(await f.row()).toMatchObject({ status: "canceled" });
  expect(await f.observations()).toEqual([]);
});

it("rejects an invalid signature before mirror or host writes", async () => {
  const f = await fixture();
  const before = await f.row();
  expect((await f.send(false)).status).toBe(400);
  expect(await f.row()).toEqual(before);
  expect(await f.observations()).toEqual([]);
});
