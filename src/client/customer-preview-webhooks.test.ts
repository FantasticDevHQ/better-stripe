import type Stripe from "stripe";
import { componentsGeneric, type HttpRouter } from "convex/server";
import { expect, it, vi } from "vitest";
import { BetterStripe } from "./index.js";
import type { Component, RunCtx } from "./helpers.js";
import {
  createWebhookEndpoint,
  setupEventDestination,
} from "./utils/webhookEndpoints.js";
const handle = vi.hoisted(() => vi.fn(async () => new Response("ok")));
vi.mock("./webhooks/handler.js", () => ({ handleWebhookRequest: handle }));
const version = "2026-09-30.preview";
const component = componentsGeneric().betterStripe as unknown as Component;
it("instance routes inherit the selected client version and reject conflicting configuration", async () => {
  const bs = new BetterStripe(component, {
    STRIPE_SECRET_KEY: "sk_test_preview_routes",
    stripeApiVersion: version,
  });
  const route = vi.fn();
  bs.registerRoutes({ route } as unknown as HttpRouter, {
    webhookSecret: "whsec_fixture",
  });
  const handler = route.mock.calls[0][0].handler as {
    _handler: (ctx: unknown, request: Request) => Promise<Response>;
  };
  await handler._handler(
    {},
    new Request("https://example.com/stripe/webhook", { method: "POST" }),
  );
  expect(handle).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    component,
    expect.objectContaining({
      stripeApiVersion: version,
      stripeSecretKey: "sk_test_preview_routes",
      webhookSecret: "whsec_fixture",
    }),
  );
  expect(() =>
    bs.registerRoutes({ route } as unknown as HttpRouter, {
      stripeApiVersion: "2026-09-30.endive",
    }),
  ).toThrow("match");
  expect(route).toHaveBeenCalledTimes(1);
});
function sdk() {
  const raw = {
    webhookEndpoints: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      create: vi.fn().mockResolvedValue({
        id: "we_preview",
        url: "https://example.com/events",
        secret: "whsec_fixture",
      }),
    },
    v2: {
      core: {
        eventDestinations: {
          list: vi.fn().mockResolvedValue({ data: [] }),
          create: vi.fn().mockResolvedValue({
            id: "ed_preview",
            enabled_events: [],
            webhook_endpoint: { signing_secret: "whsec_fixture" },
          }),
          update: vi.fn(),
        },
      },
    },
  };
  return { raw, stripe: raw as unknown as Stripe };
}
it("pins snapshot payloads, leaves thin payloads unversioned, and uses canonical preview scopes", async () => {
  const { raw, stripe } = sdk(),
    ctx = {} as RunCtx;
  await createWebhookEndpoint(stripe, ctx, {
    url: "https://example.com/events",
    apiVersion: version,
  });
  expect(raw.webhookEndpoints.create).toHaveBeenCalledWith(
    expect.objectContaining({ api_version: version }),
  );
  await setupEventDestination(stripe, ctx, {
    url: "https://example.com/events",
    eventPayload: "snapshot",
    apiVersion: version,
  });
  expect(raw.v2.core.eventDestinations.create).toHaveBeenLastCalledWith(
    expect.objectContaining({
      snapshot_api_version: version,
      events_from: ["@self"],
    }),
  );
  await setupEventDestination(stripe, ctx, {
    url: "https://example.com/events",
    eventPayload: "thin",
    apiVersion: version,
  });
  const thin = raw.v2.core.eventDestinations.create.mock.calls[1][0];
  expect(thin).not.toHaveProperty("snapshot_api_version");
  expect(thin.events_from).toEqual(["@self", "@accounts"]);
  expect(thin.enabled_events).toEqual([
    "v2.core.account.created",
    "v2.core.account[configuration.customer].updated",
    "v2.core.account[identity].updated",
  ]);
});
it("refuses to reuse a snapshot destination whose immutable version differs", async () => {
  const { raw, stripe } = sdk();
  raw.v2.core.eventDestinations.list.mockResolvedValue({
    data: [
      {
        id: "ed_old",
        event_payload: "snapshot",
        snapshot_api_version: "2026-09-30.endive",
        webhook_endpoint: { url: "https://example.com/events" },
      },
    ],
  });
  await expect(
    setupEventDestination(stripe, {} as RunCtx, {
      url: "https://example.com/events",
      eventPayload: "snapshot",
      apiVersion: version,
    }),
  ).rejects.toThrow("version");
  expect(raw.v2.core.eventDestinations.update).not.toHaveBeenCalled();
  expect(raw.v2.core.eventDestinations.create).not.toHaveBeenCalled();
});
it("refuses a preview thin destination that cannot deliver managed customer account events", async () => {
  const { raw, stripe } = sdk();
  raw.v2.core.eventDestinations.list.mockResolvedValue({
    data: [
      {
        id: "ed_old",
        event_payload: "thin",
        events_from: ["@self"],
        webhook_endpoint: { url: "https://example.com/events" },
      },
    ],
  });
  await expect(
    setupEventDestination(stripe, {} as RunCtx, {
      url: "https://example.com/events",
      eventPayload: "thin",
      apiVersion: version,
    }),
  ).rejects.toThrow("scope");
  expect(raw.v2.core.eventDestinations.update).not.toHaveBeenCalled();
});
