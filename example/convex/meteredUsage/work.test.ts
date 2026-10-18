import { afterEach, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import { stripe } from "../stripe/helpers";
import type { RunCtx } from "../../../src/client/helpers.js";
import { activityFixture } from "../../testing/meteredActivity";
import * as work from "./work";
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
it("atomically reserves and records synthetic DB work once, then permits only retained replay after the billing fence", async () => {
  expect(work.accept).toBeTypeOf("function");
  const { t, actorId, runId, meter } = await activityFixture();
  const activity = await t.mutation(internal.meteredUsage.state.activity, {
    actorId,
    runId,
    requestId: "work-1",
    quantity: "5",
  });
  const args = { actorId, runId, activityId: activity._id };
  expect(
    JSON.parse(await t.mutation(internal.meteredUsage.work.accept, args)).work,
  ).toBe("completed_once");
  await t.run((ctx) =>
    ctx.db.patch("meteredDemoRuns", runId, { billingStartedAt: 700000 }),
  );
  expect(
    JSON.parse(await t.mutation(internal.meteredUsage.work.accept, args)).work,
  ).toBe("already_completed");
  const summary = await t.action((ctx) =>
    stripe.usage.getSummary(ctx as RunCtx, {
      scope: meter.scope,
      period: meter.subscription.period,
    }),
  );
  expect(summary.eventCount).toBe(1);
  expect(summary.groups[0].acceptedQuantity).toBe("5");
});
it("fences an already prepared but unperformed work intent before it can reserve or record units", async () => {
  expect(work.accept).toBeTypeOf("function");
  const { t, actorId, runId, meter } = await activityFixture();
  const activity = await t.mutation(internal.meteredUsage.state.activity, {
    actorId,
    runId,
    requestId: "not-started",
    quantity: "5",
  });
  await t.run((ctx) =>
    ctx.db.patch("meteredDemoRuns", runId, { billingStartedAt: 700000 }),
  );
  await expect(
    t.mutation(internal.meteredUsage.work.accept, {
      actorId,
      runId,
      activityId: activity._id,
    }),
  ).rejects.toThrow(/billing period is closing/);
  const allowance = await t.action((ctx) =>
    stripe.usage.getAllowanceStatus(ctx as RunCtx, meter),
  );
  expect(allowance?.reservedQuantity).toBe("0");
  expect(allowance?.consumedQuantity).toBe("0");
  expect(
    (
      await t.query(internal.meteredUsage.state.lastActivity, {
        actorId,
        runId,
      })
    )?.completedAt,
  ).toBeUndefined();
});
it("retains the last accepted event for correction when later work cannot run", async () => {
  const { t, actorId, runId } = await activityFixture();
  const activity = await t.mutation(internal.meteredUsage.state.activity, {
    actorId,
    runId,
    requestId: "accepted",
    quantity: "5",
  });
  await t.mutation(internal.meteredUsage.work.accept, {
    actorId,
    runId,
    activityId: activity._id,
  });
  await t.mutation(internal.meteredUsage.state.activity, {
    actorId,
    runId,
    requestId: "not-performed",
    quantity: "50",
  });
  expect(
    (
      await t.query(internal.meteredUsage.state.acceptedActivity, {
        actorId,
        runId,
      })
    )?._id,
  ).toBe(activity._id);
});
it("registers a correction intent before provider I/O and permits only that retained intent during closeout", async () => {
  const { t, actorId, runId } = await activityFixture();
  const activity = await t.mutation(internal.meteredUsage.state.activity, {
    actorId,
    runId,
    requestId: "correct",
    quantity: "5",
  });
  await t.mutation(internal.meteredUsage.work.accept, {
    actorId,
    runId,
    activityId: activity._id,
  });
  const prepared = await t.mutation(
    internal.meteredUsage.state.prepareCorrection,
    { actorId, runId },
  );
  expect(prepared._id).toBe(activity._id);
  await t.mutation(internal.meteredUsage.state.freezeBilling, {
    actorId,
    runId,
  });
  expect(
    (
      await t.mutation(internal.meteredUsage.state.prepareCorrection, {
        actorId,
        runId,
      })
    )._id,
  ).toBe(activity._id);
});
it("blocks a new correction request after the billing fence", async () => {
  const { t, actorId, runId } = await activityFixture();
  const activity = await t.mutation(internal.meteredUsage.state.activity, {
    actorId,
    runId,
    requestId: "unrequested",
    quantity: "5",
  });
  await t.mutation(internal.meteredUsage.work.accept, {
    actorId,
    runId,
    activityId: activity._id,
  });
  await t.mutation(internal.meteredUsage.state.freezeBilling, {
    actorId,
    runId,
  });
  await expect(
    t.mutation(internal.meteredUsage.state.prepareCorrection, {
      actorId,
      runId,
    }),
  ).rejects.toThrow(/billing period is closing/);
});
