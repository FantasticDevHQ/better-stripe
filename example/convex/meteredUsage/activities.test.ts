import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { modules } from "../../test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { demoConfiguration } from "./policy";
beforeEach(() => vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_demo_only"));
afterEach(() => vi.unstubAllEnvs());
it("checks original ownership before consumption, replay or correction", async () => {
  const t = convexTest(schema, modules);
  const [actorId, foreignId] = await t.run((ctx) =>
    Promise.all([
      ctx.db.insert("users", {
        name: "Owner",
        email: "owner@example.invalid",
        role: "customer",
      }),
      ctx.db.insert("users", {
        name: "Foreign",
        email: "foreign@example.invalid",
        role: "customer",
      }),
    ]),
  );
  const runId = await t.mutation(internal.meteredUsage.state.begin, {
    actorId,
    model: "pay_as_you_go",
    configurationJson: JSON.stringify(demoConfiguration("pay_as_you_go")),
  });
  await expect(
    t.action(api.meteredUsage.activities.consume, {
      actorId: foreignId,
      runId,
      requestId: "work",
      quantity: "5",
    }),
  ).rejects.toThrow(/not available/);
  await expect(
    t.action(api.meteredUsage.activities.replay, { actorId: foreignId, runId }),
  ).rejects.toThrow(/not available/);
  await expect(
    t.action(api.meteredUsage.activities.correct, {
      actorId: foreignId,
      runId,
    }),
  ).rejects.toThrow(/not available/);
  expect(
    await t.run((ctx) => ctx.db.query("meteredDemoActivities").take(1)),
  ).toEqual([]);
});
