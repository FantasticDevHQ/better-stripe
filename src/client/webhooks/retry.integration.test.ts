// @vitest-environment edge-runtime
import { getFunctionAddress } from "convex/server";
import Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";

import schema from "../../component/schema.js";
import { components, initConvexTest } from "../setup.test.js";
import type { RegisterRoutesConfig } from "../types.js";
import { handleWebhookRequest } from "./handler.js";

const signingSecret = "whsec_retry_regression";
const modules = import.meta.glob("../../component/**/*.{ts,js,tsx,jsx}");

function fixture() {
  const t = initConvexTest();
  t.registerComponent("betterStripe", schema, modules);
  let attempts = 0;
  let unavailable = "";
  const event = {
    id: "evt_checkout_retry",
    object: "event",
    api_version: "2026-09-30.endive",
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        id: "cs_retry",
        mode: "payment",
        status: "complete",
        payment_status: "paid",
        metadata: { userId: "buyer", purchaseType: "communityMembership" },
      },
    },
  };
  const fulfill = async () => {
    attempts++;
    if (attempts === 1) throw new Error("Transient fulfillment failure");
  };
  const config: RegisterRoutesConfig = {
    stripeSecretKey: "sk_test_local_signature_only",
    webhookSecret: signingSecret,
    retryOnHookError: (verified) => verified.type === event.type,
    events: { [event.type]: fulfill },
  };
  const deliver = async (tamper = false) => {
    const body = JSON.stringify(event);
    const signature = await Stripe.webhooks.generateTestHeaderStringAsync({
      payload: body,
      secret: signingSecret,
    });
    return t.action(async (ctx) => {
      const runMutation: typeof ctx.runMutation = async (ref, args) => {
        if (
          unavailable &&
          getFunctionAddress(ref).reference?.endsWith(`/${unavailable}`)
        ) {
          throw new Error("Ledger unavailable");
        }
        return ctx.runMutation(ref, args);
      };
      const response = await handleWebhookRequest(
        { ...ctx, runMutation },
        new Request("https://example.test/stripe/webhook", {
          method: "POST",
          body: tamper ? body.replace("cs_retry", "cs_tampered") : body,
          headers: { "stripe-signature": signature },
        }),
        components.betterStripe,
        config,
      );
      return { status: response.status, body: await response.json() };
    });
  };
  const ledger = () =>
    t.query(components.betterStripe.webhooks.queries.getWebhookEvent, {
      stripeEventId: event.id,
    });
  return {
    t,
    event,
    config,
    fulfill,
    deliver,
    ledger,
    attempts: () => attempts,
    fail: (operation: string) => {
      unavailable = operation;
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("required V1 hooks with the real SDK signature verifier and component ledger", () => {
  it("persists checkout before fulfillment, retries a failed hook, then deduplicates", async () => {
    const f = fixture();
    expect((await f.deliver()).status).toBe(500);
    expect(await f.ledger()).toMatchObject({
      status: "failed",
      lastError: "Transient fulfillment failure",
    });
    expect(
      await f.t.query(
        components.betterStripe.billing.queries.getCheckoutSessionByStripeId,
        { stripeSessionId: "cs_retry" },
      ),
    ).toMatchObject({ status: "complete" });
    expect((await f.deliver()).status).toBe(200);
    expect(await f.ledger()).toMatchObject({ status: "processed" });
    expect(await f.deliver()).toMatchObject({
      status: 200,
      body: { deduplicated: true },
    });
    expect(f.attempts()).toBe(2);
  });

  it("requires onEvent success as well as the event-specific hook", async () => {
    const f = fixture();
    f.config.onEvent = f.fulfill;
    f.config.events = { [f.event.type]: vi.fn().mockResolvedValue(undefined) };
    expect((await f.deliver()).status).toBe(500);
    expect(f.config.events[f.event.type]).not.toHaveBeenCalled();
    expect((await f.deliver()).status).toBe(200);
    expect(f.config.events[f.event.type]).toHaveBeenCalledTimes(1);
  });

  it("verifies the signature before running the selector or touching the ledger", async () => {
    const f = fixture();
    f.config.retryOnHookError = vi.fn(() => true);
    expect((await f.deliver(true)).status).toBe(400);
    expect(f.config.retryOnHookError).not.toHaveBeenCalled();
    expect(f.attempts()).toBe(0);
    expect(await f.ledger()).toBeNull();
  });

  it.each([undefined, () => false])(
    "preserves best-effort hooks when the selector is %s",
    async (selector) => {
      const f = fixture();
      f.config.retryOnHookError = selector;
      expect((await f.deliver()).status).toBe(200);
      expect(await f.ledger()).toMatchObject({ status: "processed" });
      await f.deliver();
      expect(f.attempts()).toBe(1);
    },
  );

  it("returns 503 for an in-flight delivery without concurrent fulfillment", async () => {
    const f = fixture();
    await f.t.mutation(
      components.betterStripe.webhooks.mutations.insertWebhookEvent,
      {
        stripeEventId: f.event.id,
        eventType: f.event.type,
        livemode: false,
      },
    );
    expect((await f.deliver()).status).toBe(503);
    expect(f.attempts()).toBe(0);
  });

  it("fails closed if reservation is unavailable", async () => {
    const f = fixture();
    f.fail("insertWebhookEvent");
    expect((await f.deliver()).status).toBe(500);
    expect(await f.ledger()).toBeNull();
    expect(f.attempts()).toBe(0);
  });

  it.each(["markWebhookEventProcessed", "markWebhookEventFailed"])(
    "recovers a stale reservation after %s fails",
    async (operation) => {
      const f = fixture();
      if (operation === "markWebhookEventProcessed") await f.deliver();
      f.fail(operation);
      expect((await f.deliver()).status).toBe(500);
      expect(await f.ledger()).toMatchObject({ status: "processing" });
      f.fail("");
      expect((await f.deliver()).status).toBe(503);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 11 * 60 * 1000);
      expect((await f.deliver()).status).toBe(200);
      expect(await f.ledger()).toMatchObject({ status: "processed" });
    },
  );

  it("returns a retryable response when the selection policy throws", async () => {
    const f = fixture();
    f.config.retryOnHookError = () => {
      throw new Error("Policy unavailable");
    };
    expect((await f.deliver()).status).toBe(500);
    expect(await f.ledger()).toBeNull();
    expect(f.attempts()).toBe(0);
  });
});
