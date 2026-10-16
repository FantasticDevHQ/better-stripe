// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";
import { schema, modules } from "../../test.js";

describe("webhooks — listWebhookEvents", () => {
  it("returns all events in descending order", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("webhookEvents", {
        stripeEventId: "evt_list_1",
        eventType: "invoice.paid",
        status: "processed",
        processedAt: Date.now() - 1000,
      });
      await ctx.db.insert("webhookEvents", {
        stripeEventId: "evt_list_2",
        eventType: "checkout.session.completed",
        status: "processed",
        processedAt: Date.now(),
      });
    });

    const events = await t.query(api.webhooks.queries.listWebhookEvents, {});

    expect(events).toHaveLength(2);
    // Most recent first
    expect(events[0].stripeEventId).toBe("evt_list_2");
  });

  it("filters by eventType", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("webhookEvents", {
        stripeEventId: "evt_type_1",
        eventType: "invoice.paid",
        status: "processed",
        processedAt: Date.now(),
      });
      await ctx.db.insert("webhookEvents", {
        stripeEventId: "evt_type_2",
        eventType: "checkout.session.completed",
        status: "processed",
        processedAt: Date.now(),
      });
    });

    const invoiceEvents = await t.query(
      api.webhooks.queries.listWebhookEvents,
      {
        eventType: "invoice.paid",
      },
    );

    expect(invoiceEvents).toHaveLength(1);
    expect(invoiceEvents[0].eventType).toBe("invoice.paid");
  });

  it("filters by status", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("webhookEvents", {
        stripeEventId: "evt_st_1",
        eventType: "invoice.paid",
        status: "processed",
        processedAt: Date.now(),
      });
      await ctx.db.insert("webhookEvents", {
        stripeEventId: "evt_st_2",
        eventType: "invoice.paid",
        status: "failed",
        processedAt: Date.now(),
        lastError: "Something went wrong",
      });
    });

    const failed = await t.query(api.webhooks.queries.listWebhookEvents, {
      status: "failed",
    });

    expect(failed).toHaveLength(1);
    expect(failed[0].stripeEventId).toBe("evt_st_2");
  });

  it("combines eventType and status filters", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("webhookEvents", {
        stripeEventId: "evt_combo_1",
        eventType: "invoice.paid",
        status: "processed",
        processedAt: Date.now(),
      });
      await ctx.db.insert("webhookEvents", {
        stripeEventId: "evt_combo_2",
        eventType: "invoice.paid",
        status: "failed",
        processedAt: Date.now(),
      });
      await ctx.db.insert("webhookEvents", {
        stripeEventId: "evt_combo_3",
        eventType: "checkout.session.completed",
        status: "failed",
        processedAt: Date.now(),
      });
    });

    const result = await t.query(api.webhooks.queries.listWebhookEvents, {
      eventType: "invoice.paid",
      status: "failed",
    });

    expect(result).toHaveLength(1);
    expect(result[0].stripeEventId).toBe("evt_combo_2");
  });
});
