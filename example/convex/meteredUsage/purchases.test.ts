import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { modules } from "../../test";
import schema from "../schema";
import { internal } from "../_generated/api";
import { demoConfiguration } from "./policy";
afterEach(() => vi.unstubAllEnvs());
it("retains purchase identities at the bounded history limit and refuses hidden tail records", async () => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_demo_only");
  const t = convexTest(schema, modules);
  const actorId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Buyer",
      email: "buyer@example.invalid",
      role: "customer",
    }),
  );
  const runId = await t.mutation(internal.meteredUsage.state.begin, {
    actorId,
    model: "prepaid",
    configurationJson: JSON.stringify(demoConfiguration("prepaid")),
  });
  const ref = { actorId, runId };
  const first = await t.mutation(internal.meteredUsage.purchases.prepare, {
    ...ref,
    requestId: "purchase_0",
  });
  for (let i = 1; i < 20; i++)
    await t.mutation(internal.meteredUsage.purchases.prepare, {
      ...ref,
      requestId: `purchase_${i}`,
    });
  expect(await t.query(internal.meteredUsage.purchases.list, ref)).toHaveLength(
    20,
  );
  await expect(
    t.mutation(internal.meteredUsage.purchases.prepare, {
      ...ref,
      requestId: "new_purchase",
    }),
  ).rejects.toThrow(/budget/);
  await t.mutation(internal.meteredUsage.state.freezeBilling, ref);
  expect(
    (
      await t.mutation(internal.meteredUsage.purchases.prepare, {
        ...ref,
        requestId: "purchase_0",
      })
    )._id,
  ).toBe(first._id);
  await expect(
    t.mutation(internal.meteredUsage.purchases.prepare, {
      ...ref,
      requestId: "after_close",
    }),
  ).rejects.toThrow(/closing/);
  await t.run((ctx) =>
    ctx.db.insert("meteredDemoPurchases", {
      runId,
      requestId: "legacy_tail",
      quantity: "10",
      createdAt: Date.now(),
    }),
  );
  await expect(
    t.query(internal.meteredUsage.purchases.list, ref),
  ).rejects.toThrow(/complete/i);
});
