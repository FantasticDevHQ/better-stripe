import { convexTest } from "convex-test";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { modules } from "../../test";
import schema from "../schema";
import { api } from "../_generated/api";
import { demoConfiguration } from "./policy";
beforeEach(() => vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_demo_only"));
afterEach(() => vi.unstubAllEnvs());
it("denies an unsupported persona before making native setup calls", async () => {
  const t = convexTest(schema, modules);
  const actorId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Visitor",
      email: "visitor@example.invalid",
      role: "visitor",
    }),
  );
  await expect(
    t.action(api.meteredUsage.setup.setup, { actorId, model: "pay_as_you_go" }),
  ).rejects.toThrow(/not available for this persona/);
  expect(await t.run((ctx) => ctx.db.query("meteredDemoRuns").take(1))).toEqual(
    [],
  );
});
it("keeps custom configuration behind the admin/seller demo binding", async () => {
  const t = convexTest(schema, modules);
  const actorId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Customer",
      email: "customer@example.invalid",
      role: "customer",
    }),
  );
  await expect(
    t.action(api.meteredUsage.setup.setup, {
      actorId,
      model: "prepaid",
      configurationJson: JSON.stringify(demoConfiguration("prepaid")),
    }),
  ).rejects.toThrow(/admin or seller/);
  expect(await t.run((ctx) => ctx.db.query("meteredDemoRuns").take(1))).toEqual(
    [],
  );
});
it("validates an admin configuration before persisting provider fixture intents", async () => {
  const t = convexTest(schema, modules);
  const actorId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Admin",
      email: "admin@example.invalid",
      role: "admin",
    }),
  );
  await expect(
    t.action(api.meteredUsage.setup.setup, {
      actorId,
      model: "prepaid",
      configurationJson: "{}",
    }),
  ).rejects.toThrow(/malformed/);
  expect(
    await t.run((ctx) => ctx.db.query("meteredDemoResources").take(1)),
  ).toEqual([]);
});
