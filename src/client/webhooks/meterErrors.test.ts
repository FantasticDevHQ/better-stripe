import Stripe from "stripe";
import { expect, it, vi } from "vitest";
import type { Component } from "../helpers.js";
import type { WebhookActionCtx } from "../types.js";
import { componentsGeneric } from "convex/server";
import { STRIPE_API_VERSION } from "../constants.js";
const fixture = vi.hoisted(() => ({ stripe: undefined as unknown }));
vi.mock("./helpers.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./helpers.js")>()),
  getStripeClient: () => fixture.stripe,
}));
import { handleWebhookRequest } from "./handler.js";
it("verifies and fetches v1 meter thin events without the snapshot parser", async () => {
  const body = JSON.stringify({
    id: "evt_meter_error",
    object: "v2.core.event",
    type: "v1.billing.meter.error_report_triggered",
    livemode: false,
    related_object: { id: "mtr_calls", type: "billing.meter" },
  });
  const parse = vi.fn().mockResolvedValue({});
  const full = {
    id: "evt_meter_error",
    type: "v1.billing.meter.error_report_triggered",
    livemode: false,
    related_object: { id: "mtr_calls", type: "billing.meter" },
    data: {
      reason: {
        error_types: [
          {
            code: "meter_event_invalid_value",
            sample_errors: [
              {
                error_message: "private raw error",
                request: { idempotency_key: "bs_usage_event" },
              },
            ],
          },
        ],
      },
    },
  };
  fixture.stripe = {
    parseEventNotificationAsync: parse,
    v2: { core: { events: { retrieve: vi.fn().mockResolvedValue(full) } } },
    accounts: { retrieve: vi.fn().mockResolvedValue({ id: "acct_platform" }) },
    balance: { retrieve: vi.fn().mockResolvedValue({ livemode: false }) },
    webhooks: {
      constructEventAsync: vi.fn().mockRejectedValue(new Error("Wrong parser")),
    },
  } as unknown as Stripe;
  const runMutation = vi.fn(async (_ref, args) =>
    typeof args.stripeEventId === "string" && args.eventType
      ? "inserted"
      : { matched: 1, unattributed: 0, truncated: false },
  );
  const ctx = { runMutation, runQuery: vi.fn() } as unknown as WebhookActionCtx;
  const response = await handleWebhookRequest(
    ctx,
    new Request("https://example.test/webhook", {
      method: "POST",
      headers: { "stripe-signature": "verified-fixture" },
      body,
    }),
    componentsGeneric().betterStripe as unknown as Component,
    {
      stripeSecretKey: "sk_test_fixture",
      webhookSecret: "whsec_snapshot",
      webhookSecretV2: "whsec_thin",
      stripeApiVersion: STRIPE_API_VERSION,
    },
  );
  expect(response.status).toBe(200);
  expect(parse).toHaveBeenCalledWith(body, "verified-fixture", "whsec_thin");
  const report = runMutation.mock.calls.find(([, args]) => args.samples)?.[1];
  expect(report).toMatchObject({
    stripeAccountId: "acct_platform",
    livemode: false,
    meterId: "mtr_calls",
    samples: [
      { identifier: "bs_usage_event", code: "meter_event_invalid_value" },
    ],
  });
  expect(JSON.stringify(report)).not.toContain("private raw error");
});
