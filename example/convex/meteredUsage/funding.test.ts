import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { modules } from "../../test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { demoConfiguration } from "./policy";
beforeEach(() => vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_demo_only"));
afterEach(() => vi.unstubAllEnvs());
it("rejects foreign purchase and card-confirmation attempts before touching payment resources", async () => {
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
    model: "prepaid",
    configurationJson: JSON.stringify(demoConfiguration("prepaid")),
  });
  await expect(
    t.action(api.meteredUsage.funding.purchase, {
      actorId: foreignId,
      runId,
      requestId: "foreign",
    }),
  ).rejects.toThrow(/not available/);
  await expect(
    t.action(api.meteredUsage.funding.confirm, { actorId: foreignId, runId }),
  ).rejects.toThrow(/not available/);
  expect(
    await t.run((ctx) => ctx.db.query("meteredDemoPurchases").take(1)),
  ).toEqual([]);
});
