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
import { expect, it, vi } from "vitest";

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
const secret = "whsec_synthetic_subscription_ordering";
const key = "sk_test_subscription_ordering";
const SUB = "sub_out_of_order";
const recordRef = makeFunctionReference<
  "mutation",
  { kind: string; status: string },
  null
>("orderingHost:record");

type EventType =
  | "customer.subscription.created"
  | "customer.subscription.updated"
  | "customer.subscription.deleted";

async function fixture(options: { isRegistered?: boolean } = {}) {
  const record =
    (kind: string) =>
    async (ctx: SyncTriggerCtx, doc: StripeComponentSubscription) => {
      await ctx.runMutation(recordRef, { kind, status: doc.status });
    };
  const sdk = new BetterStripe(component, {
    STRIPE_SECRET_KEY: key,
    triggers: {
      subscription: {
        onCreate: record("create"),
        onUpdate: record("update"),
        onDelete: record("delete"),
      },
    },
  });
  const http = httpRouter();
  registerRoutes(http, component, {
    stripeSecretKey: key,
    webhookSecret: secret,
    ...(options.isRegistered === false
      ? {}
      : {
          webhooks: {
            syncWebhook: makeFunctionReference("orderingHost:syncWebhook"),
            asyncWebhook: makeFunctionReference("orderingHost:asyncWebhook"),
          } as unknown as WebhookHandlerRefs,
        }),
  });
  const t = convexTest(
    defineSchema({
      calls: defineTable({ kind: v.string(), status: v.string() }),
    }),
    {
      "./_generated/server.ts": () =>
        import("../../component/_generated/server.js"),
      "./http.ts": async () => ({ default: http }),
      "./orderingHost.ts": async () => ({
        ...sdk.webhookHandlers(),
        record: internalMutationGeneric({
          args: { kind: v.string(), status: v.string() },
          returns: v.null(),
          handler: async (ctx, args) => {
            await ctx.db.insert("calls", args);
            return null;
          },
        }),
      }),
    },
  );
  t.registerComponent(
    "betterStripe",
    schema,
    Object.fromEntries(
      Object.entries(modules).map(([path, loader]) => [
        path.split("/component/")[1]!,
        loader,
      ]),
    ),
  );
  const send = async (
    eventId: string,
    type: EventType,
    created: number,
    status: string,
    quantity = 1,
  ) => {
    const body = JSON.stringify({
      id: eventId,
      object: "event",
      type,
      livemode: false,
      created,
      data: {
        object: {
          id: SUB,
          object: "subscription",
          customer_account: "acct_ordering",
          status,
          cancel_at_period_end: false,
          canceled_at: status === "canceled" ? created : null,
          metadata: { userId: "buyer_ordering" },
          items: { data: [{ price: { id: "price_ordering" }, quantity }] },
        },
      },
    });
    const signature = await Stripe.webhooks.generateTestHeaderStringAsync({
      payload: body,
      secret,
    });
    const response = await t.fetch("/stripe/webhook", {
      method: "POST",
      body,
      headers: { "stripe-signature": signature },
    });
    return response.status;
  };
  return {
    t,
    send,
    row: () =>
      t.query(component.billing.queries.getSubscriptionByStripeId, {
        stripeSubscriptionId: SUB,
      }) as Promise<StripeComponentSubscription | null>,
    calls: async () =>
      (await t.run((ctx) => ctx.db.query("calls").collect())).map(
        (call) => `${call.kind}:${call.status}`,
      ),
    ledgerStatus: async (stripeEventId: string) =>
      (
        (await t.query(component.webhooks.queries.getWebhookEvent, {
          stripeEventId,
        })) as { status: string } | null
      )?.status,
  };
}

it("keeps a canceled subscription canceled and fires no trigger for a late update", async () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const f = await fixture();
  expect(
    await f.send("evt_created", "customer.subscription.created", 100, "active"),
  ).toBe(200);
  expect(
    await f.send(
      "evt_deleted",
      "customer.subscription.deleted",
      300,
      "canceled",
    ),
  ).toBe(200);
  const canceled = await f.row();
  expect(canceled).toMatchObject({ status: "canceled", lastEventCreated: 300 });
  expect(await f.calls()).toEqual(["create:active", "delete:canceled"]);

  // Generated before the deletion, delivered after it.
  expect(
    await f.send(
      "evt_late_update",
      "customer.subscription.updated",
      200,
      "active",
      5,
    ),
  ).toBe(200);

  expect(await f.row()).toEqual(canceled);
  expect(await f.calls()).toEqual(["create:active", "delete:canceled"]);
  // The stale event was handled: it must not be redelivered forever.
  expect(await f.ledgerStatus("evt_late_update")).toBe("processed");
  expect(
    info.mock.calls.some(([line]) =>
      String(line).includes(`skipped stale event for ${SUB}`),
    ),
  ).toBe(true);
  info.mockRestore();
});

it("applies in-order events and fires each trigger once", async () => {
  const f = await fixture();
  await f.send("evt_1", "customer.subscription.created", 100, "trialing");
  await f.send("evt_2", "customer.subscription.updated", 200, "active", 2);
  await f.send("evt_3", "customer.subscription.updated", 300, "past_due", 3);
  expect(await f.row()).toMatchObject({
    status: "past_due",
    quantity: 3,
    lastEventCreated: 300,
  });
  expect(await f.calls()).toEqual([
    "create:trialing",
    "update:active",
    "update:past_due",
  ]);
});

it("skips a late deletion older than the applied state without firing onDelete", async () => {
  const f = await fixture();
  await f.send("evt_new", "customer.subscription.updated", 300, "active");
  expect(
    await f.send("evt_old", "customer.subscription.deleted", 200, "canceled"),
  ).toBe(200);
  expect(await f.row()).toMatchObject({ status: "active" });
  expect(await f.calls()).toEqual(["create:active"]);
  expect(await f.ledgerStatus("evt_old")).toBe("processed");
});

it("lets the cancellation win a same-second tie in either delivery order", async () => {
  const first = await fixture();
  await first.send("evt_a", "customer.subscription.created", 100, "active");
  await first.send("evt_b", "customer.subscription.deleted", 500, "canceled");
  await first.send("evt_c", "customer.subscription.updated", 500, "active");
  expect(await first.row()).toMatchObject({ status: "canceled" });
  expect(await first.calls()).toEqual(["create:active", "delete:canceled"]);

  const second = await fixture();
  await second.send("evt_a", "customer.subscription.created", 100, "active");
  await second.send("evt_c", "customer.subscription.updated", 500, "past_due");
  await second.send("evt_b", "customer.subscription.deleted", 500, "canceled");
  expect(await second.row()).toMatchObject({ status: "canceled" });
  expect(await second.calls()).toEqual([
    "create:active",
    "update:past_due",
    "delete:canceled",
  ]);
});

it("protects the mirror without registered host dispatchers", async () => {
  const f = await fixture({ isRegistered: false });
  await f.send("evt_deleted", "customer.subscription.deleted", 300, "canceled");
  expect(
    await f.send("evt_late", "customer.subscription.updated", 200, "active"),
  ).toBe(200);
  expect(await f.row()).toMatchObject({
    status: "canceled",
    lastEventCreated: 300,
  });
  expect(await f.ledgerStatus("evt_late")).toBe("processed");
});
