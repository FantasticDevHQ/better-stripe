// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/**
 * Tests for the example app's trigger/hook observability recorder
 * (`triggerLogger.ts`).
 *
 * BTS-91: `record` writes a row per sync-trigger/async-hook invocation (see
 * stripe.ts); `listTriggerLog` is the E2E harness's read model over that log,
 * filterable by kind / source / a creation-time cutoff; `clearTriggerLog` resets
 * it between E2E runs. None of the filter combinations or the delete-count path
 * had unit coverage before this — only app-schema (`triggerLog` table)
 * functions, so no betterStripe component registration is needed here.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

describe("triggerLogger — listTriggerLog", () => {
  it("lists all rows newest first when no filters are given", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.triggerLogger.record, {
      source: "trigger",
      kind: "subscription.onCreate",
      stripeId: "sub_1",
    });
    await t.mutation(internal.triggerLogger.record, {
      source: "hook",
      kind: "onPayoutCompleted",
      stripeId: "po_1",
    });

    const rows = await t.query(internal.triggerLogger.listTriggerLog, {});
    expect(rows.map((r) => r.stripeId)).toEqual(["po_1", "sub_1"]);
  });

  it("filters by kind", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.triggerLogger.record, {
      source: "trigger",
      kind: "subscription.onCreate",
      stripeId: "sub_1",
    });
    await t.mutation(internal.triggerLogger.record, {
      source: "trigger",
      kind: "subscription.onUpdate",
      stripeId: "sub_1",
    });
    await t.mutation(internal.triggerLogger.record, {
      source: "hook",
      kind: "onPayoutCompleted",
      stripeId: "po_1",
    });

    const rows = await t.query(internal.triggerLogger.listTriggerLog, {
      kind: "subscription.onCreate",
    });
    expect(rows.map((r) => r.kind)).toEqual(["subscription.onCreate"]);
  });

  it("filters by source", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.triggerLogger.record, {
      source: "trigger",
      kind: "subscription.onCreate",
      stripeId: "sub_1",
    });
    await t.mutation(internal.triggerLogger.record, {
      source: "hook",
      kind: "onPayoutCompleted",
      stripeId: "po_1",
    });

    const hookRows = await t.query(internal.triggerLogger.listTriggerLog, {
      source: "hook",
    });
    expect(hookRows.map((r) => r.stripeId)).toEqual(["po_1"]);

    const triggerRows = await t.query(internal.triggerLogger.listTriggerLog, {
      source: "trigger",
    });
    expect(triggerRows.map((r) => r.stripeId)).toEqual(["sub_1"]);
  });

  it("combines a kind filter with a source filter", async () => {
    const t = convexTest(schema, modules);
    // Same kind, recorded from both a sync trigger and (hypothetically) a hook
    // — the combination must narrow to the single matching source.
    await t.mutation(internal.triggerLogger.record, {
      source: "trigger",
      kind: "checkoutSession.onCompleted",
      stripeId: "cs_1",
    });
    await t.mutation(internal.triggerLogger.record, {
      source: "hook",
      kind: "checkoutSession.onCompleted",
      stripeId: "cs_2",
    });

    const rows = await t.query(internal.triggerLogger.listTriggerLog, {
      kind: "checkoutSession.onCompleted",
      source: "hook",
    });
    expect(rows.map((r) => r.stripeId)).toEqual(["cs_2"]);
  });

  it("returns an empty array when the kind filter matches nothing", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.triggerLogger.record, {
      source: "trigger",
      kind: "subscription.onCreate",
      stripeId: "sub_1",
    });

    const rows = await t.query(internal.triggerLogger.listTriggerLog, {
      kind: "subscription.onDelete",
    });
    expect(rows).toEqual([]);
  });

  it("filters by sinceCreationTime, excluding rows recorded before the cutoff", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(internal.triggerLogger.record, {
      source: "trigger",
      kind: "subscription.onCreate",
      stripeId: "sub_old",
    });
    const afterFirst = await t.query(internal.triggerLogger.listTriggerLog, {});
    const oldCreationTime = afterFirst[0]._creationTime;

    await t.mutation(internal.triggerLogger.record, {
      source: "trigger",
      kind: "subscription.onUpdate",
      stripeId: "sub_new",
    });
    const afterSecond = await t.query(internal.triggerLogger.listTriggerLog, {});
    const newRow = afterSecond.find((r) => r.stripeId === "sub_new")!;
    expect(oldCreationTime).toBeLessThan(newRow._creationTime);

    // The cutoff is the newer row's own creationTime — the filter keeps rows
    // with `_creationTime >= sinceCreationTime`, so this excludes the older
    // row while still including the newer one (inclusive boundary).
    const rows = await t.query(internal.triggerLogger.listTriggerLog, {
      sinceCreationTime: newRow._creationTime,
    });
    expect(rows.map((r) => r.stripeId)).toEqual(["sub_new"]);
  });
});

describe("triggerLogger — clearTriggerLog", () => {
  it("deletes every row and reports the delete count", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.triggerLogger.record, {
      source: "trigger",
      kind: "subscription.onCreate",
      stripeId: "sub_1",
    });
    await t.mutation(internal.triggerLogger.record, {
      source: "hook",
      kind: "onPayoutCompleted",
      stripeId: "po_1",
    });

    const result = await t.mutation(
      internal.triggerLogger.clearTriggerLog,
      {},
    );
    expect(result).toEqual({ deleted: 2 });

    const rows = await t.query(internal.triggerLogger.listTriggerLog, {});
    expect(rows).toEqual([]);
  });

  it("reports zero deletions when the table is already empty", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(
      internal.triggerLogger.clearTriggerLog,
      {},
    );
    expect(result).toEqual({ deleted: 0 });
  });
});
