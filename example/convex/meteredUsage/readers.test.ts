import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { modules } from "../../test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { demoConfiguration } from "./policy";
beforeEach(() => vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_demo_only"));
afterEach(() => vi.unstubAllEnvs());
async function setup() {
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
  return { t, actorId, foreignId, runId };
}
it("returns only the claimed persona's configured fixture, with no invented provider or paid state", async () => {
  const { t, actorId, foreignId } = await setup();
  const current = await t.query(api.meteredUsage.readers.current, {
    actorId,
    model: "pay_as_you_go",
  });
  expect(current).not.toBeNull();
  expect(JSON.parse(current!).providerJson).toBeUndefined();
  expect(
    await t.query(api.meteredUsage.readers.current, {
      actorId: foreignId,
      model: "pay_as_you_go",
    }),
  ).toBeNull();
});
it("rejects foreign summary/history requests before reading any package data", async () => {
  const { t, foreignId: actorId, runId } = await setup();
  await expect(
    t.action(api.meteredUsage.readers.snapshot, { actorId, runId }),
  ).rejects.toThrow(/not available/);
  await expect(
    t.action(api.meteredUsage.readers.history, {
      actorId,
      runId,
      limit: 10,
      cursor: null,
    }),
  ).rejects.toThrow(/not available/);
});
it("does not render an incomplete setup as a zero-usage or empty-history success", async () => {
  const { t, actorId, runId } = await setup();
  await expect(
    t.action(api.meteredUsage.readers.snapshot, { actorId, runId }),
  ).rejects.toThrow(/Setup is incomplete/);
  await expect(
    t.action(api.meteredUsage.readers.history, {
      actorId,
      runId,
      limit: 10,
      cursor: null,
    }),
  ).rejects.toThrow(/Setup is incomplete/);
});
