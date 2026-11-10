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

describe("webhooks — pruneWebhookEvents", () => {
  const DAY = 24 * 60 * 60 * 1000;
  type Status = "processing" | "processed" | "failed" | "ignored";
  const seed = (
    t: ReturnType<typeof convexTest>,
    rows: Array<{ id: string; status: Status; ageDays: number }>,
  ) =>
    t.run(async (ctx) => {
      for (const row of rows)
        await ctx.db.insert("webhookEvents", {
          stripeEventId: row.id,
          eventType: "invoice.paid",
          status: row.status,
          processedAt: Date.now() - row.ageDays * DAY,
        });
    });
  const remaining = async (t: ReturnType<typeof convexTest>) =>
    (await t.query(api.webhooks.queries.listWebhookEvents, {}))
      .map((event) => event.stripeEventId)
      .sort();

  it("deletes old terminal rows and keeps recent and processing rows", async () => {
    const t = convexTest(schema, modules);
    await seed(t, [
      { id: "evt_old_processed", status: "processed", ageDays: 31 },
      { id: "evt_old_ignored", status: "ignored", ageDays: 45 },
      { id: "evt_old_failed", status: "failed", ageDays: 60 },
      { id: "evt_old_processing", status: "processing", ageDays: 90 },
      { id: "evt_recent_processed", status: "processed", ageDays: 29 },
      { id: "evt_recent_failed", status: "failed", ageDays: 1 },
    ]);

    const result = await t.mutation(
      api.webhooks.mutations.pruneWebhookEvents,
      {},
    );

    expect(result).toEqual({ deleted: 3, hasMore: false });
    expect(await remaining(t)).toEqual([
      "evt_old_processing",
      "evt_recent_failed",
      "evt_recent_processed",
    ]);
  });

  it("honors a custom retention window", async () => {
    const t = convexTest(schema, modules);
    await seed(t, [
      { id: "evt_5d", status: "processed", ageDays: 5 },
      { id: "evt_2d", status: "processed", ageDays: 2 },
    ]);

    const result = await t.mutation(api.webhooks.mutations.pruneWebhookEvents, {
      olderThanMs: 3 * DAY,
    });

    expect(result).toEqual({ deleted: 1, hasMore: false });
    expect(await remaining(t)).toEqual(["evt_2d"]);
  });

  it("respects the limit across statuses and reports hasMore until drained", async () => {
    const t = convexTest(schema, modules);
    await seed(t, [
      { id: "evt_a", status: "processed", ageDays: 40 },
      { id: "evt_b", status: "processed", ageDays: 41 },
      { id: "evt_c", status: "ignored", ageDays: 42 },
      { id: "evt_d", status: "failed", ageDays: 43 },
      { id: "evt_e", status: "failed", ageDays: 44 },
    ]);
    const prune = () =>
      t.mutation(api.webhooks.mutations.pruneWebhookEvents, { limit: 2 });

    expect(await prune()).toEqual({ deleted: 2, hasMore: true });
    expect(await remaining(t)).toHaveLength(3);
    expect(await prune()).toEqual({ deleted: 2, hasMore: true });
    expect(await prune()).toEqual({ deleted: 1, hasMore: false });
    expect(await remaining(t)).toEqual([]);
  });

  it("reports hasMore false when the batch exactly drains the backlog", async () => {
    const t = convexTest(schema, modules);
    await seed(t, [
      { id: "evt_a", status: "processed", ageDays: 40 },
      { id: "evt_b", status: "failed", ageDays: 41 },
    ]);
    expect(
      await t.mutation(api.webhooks.mutations.pruneWebhookEvents, { limit: 2 }),
    ).toEqual({ deleted: 2, hasMore: false });
  });

  it("clamps the limit to 1000 rows per call", async () => {
    const t = convexTest(schema, modules);
    await seed(
      t,
      Array.from({ length: 1002 }, (_, i) => ({
        id: `evt_bulk_${i}`,
        status: "processed" as const,
        ageDays: 40,
      })),
    );
    expect(
      await t.mutation(api.webhooks.mutations.pruneWebhookEvents, {
        limit: 50_000,
      }),
    ).toEqual({ deleted: 1000, hasMore: true });
  });

  it("rejects a retention window below the three-day replay floor", async () => {
    const t = convexTest(schema, modules);
    await seed(t, [{ id: "evt_keep", status: "processed", ageDays: 2.5 }]);

    await expect(
      t.mutation(api.webhooks.mutations.pruneWebhookEvents, {
        olderThanMs: 3 * DAY - 1,
      }),
    ).rejects.toThrow(/at least .*3 days/);
    await expect(
      t.mutation(api.webhooks.mutations.pruneWebhookEvents, {
        olderThanMs: Number.NaN,
      }),
    ).rejects.toThrow(/at least .*3 days/);
    expect(await remaining(t)).toEqual(["evt_keep"]);
  });
});
