// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.*s");

describe("webhook event ledger", () => {
  it("insertWebhookEvent: creates new entry with processing status", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.webhooks.mutations.insertWebhookEvent, {
      stripeEventId: "evt_test_001",
      eventType: "checkout.session.completed",
    });

    const entry = await t.query(api.webhooks.queries.getWebhookEvent, {
      stripeEventId: "evt_test_001",
    });

    expect(entry).not.toBeNull();
    expect(entry!.status).toBe("processing");
    expect(entry!.eventType).toBe("checkout.session.completed");
  });

  it("insertWebhookEvent: returns inserted for new events", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(api.webhooks.mutations.insertWebhookEvent, {
      stripeEventId: "evt_test_002",
      eventType: "invoice.paid",
    });

    expect(result).toBe("inserted");
  });

  it("insertWebhookEvent: returns processed for already-processed events", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.webhooks.mutations.insertWebhookEvent, {
      stripeEventId: "evt_test_003",
      eventType: "invoice.paid",
    });

    await t.mutation(api.webhooks.mutations.markWebhookEventProcessed, {
      stripeEventId: "evt_test_003",
    });

    const result = await t.mutation(api.webhooks.mutations.insertWebhookEvent, {
      stripeEventId: "evt_test_003",
      eventType: "invoice.paid",
    });

    expect(result).toBe("processed");
  });

  it("insertWebhookEvent: returns processing for in-flight events", async () => {
    const t = convexTest(schema, modules);

    const firstResult = await t.mutation(
      api.webhooks.mutations.insertWebhookEvent,
      {
        stripeEventId: "evt_test_004",
        eventType: "customer.subscription.updated",
      },
    );
    expect(firstResult).toBe("inserted");

    const secondResult = await t.mutation(
      api.webhooks.mutations.insertWebhookEvent,
      {
        stripeEventId: "evt_test_004",
        eventType: "customer.subscription.updated",
      },
    );

    expect(secondResult).toBe("processing");
  });

  it("markWebhookEventProcessed: updates status to processed", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.webhooks.mutations.insertWebhookEvent, {
      stripeEventId: "evt_test_005",
      eventType: "payment_intent.succeeded",
    });

    await t.mutation(api.webhooks.mutations.markWebhookEventProcessed, {
      stripeEventId: "evt_test_005",
    });

    const entry = await t.query(api.webhooks.queries.getWebhookEvent, {
      stripeEventId: "evt_test_005",
    });

    expect(entry).not.toBeNull();
    expect(entry!.status).toBe("processed");
  });

  it("markWebhookEventFailed: updates status and error message", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.webhooks.mutations.insertWebhookEvent, {
      stripeEventId: "evt_test_006",
      eventType: "invoice.payment_failed",
    });

    await t.mutation(api.webhooks.mutations.markWebhookEventFailed, {
      stripeEventId: "evt_test_006",
      error: "Card declined",
    });

    const entry = await t.query(api.webhooks.queries.getWebhookEvent, {
      stripeEventId: "evt_test_006",
    });

    expect(entry).not.toBeNull();
    expect(entry!.status).toBe("failed");
    expect(entry!.lastError).toBe("Card declined");
  });

  it("markWebhookEventIgnored: updates status to ignored", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.webhooks.mutations.insertWebhookEvent, {
      stripeEventId: "evt_test_007",
      eventType: "radar.early_fraud_warning.created",
    });

    await t.mutation(api.webhooks.mutations.markWebhookEventIgnored, {
      stripeEventId: "evt_test_007",
    });

    const entry = await t.query(api.webhooks.queries.getWebhookEvent, {
      stripeEventId: "evt_test_007",
    });

    expect(entry).not.toBeNull();
    expect(entry!.status).toBe("ignored");
  });

  it("getWebhookEvent: returns null for unknown events", async () => {
    const t = convexTest(schema, modules);

    const entry = await t.query(api.webhooks.queries.getWebhookEvent, {
      stripeEventId: "evt_nonexistent",
    });

    expect(entry).toBeNull();
  });

  it("getWebhookEvent: returns entry for known events", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.webhooks.mutations.insertWebhookEvent, {
      stripeEventId: "evt_test_009",
      eventType: "checkout.session.completed",
      livemode: false,
    });

    const entry = await t.query(api.webhooks.queries.getWebhookEvent, {
      stripeEventId: "evt_test_009",
    });

    expect(entry).not.toBeNull();
    expect(entry!.stripeEventId).toBe("evt_test_009");
    expect(entry!.eventType).toBe("checkout.session.completed");
    expect(entry!.livemode).toBe(false);
    expect(entry!.processedAt).toBeTypeOf("number");
  });

  it("insertWebhookEvent is atomic under repeated calls", async () => {
    const t = convexTest(schema, modules);

    const firstResult = await t.mutation(
      api.webhooks.mutations.insertWebhookEvent,
      {
        stripeEventId: "evt_test_010",
        eventType: "invoice.paid",
      },
    );

    const secondResult = await t.mutation(
      api.webhooks.mutations.insertWebhookEvent,
      {
        stripeEventId: "evt_test_010",
        eventType: "invoice.paid",
      },
    );

    expect(firstResult).toBe("inserted");
    expect(secondResult).toBe("processing");
  });
});
