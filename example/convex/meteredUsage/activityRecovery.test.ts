import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { modules } from "../../test";
import schema from "../schema";
import componentSchema from "../../../src/component/schema.js";
import { fixture } from "../../../src/client/usage/subscriptionTransport.fixtures.js";
import { request } from "../../../src/client/usage/subscription.fixtures.js";
import { ensureManagedSubscription } from "../../../src/client/usage/subscriptionProvider.js";
import type { RunCtx } from "../../../src/client/helpers.js";
import { api, internal } from "../_generated/api";
import { stripe } from "../stripe/helpers";
import { demoConfiguration } from "./policy";
import { ensureDemoAllowance } from "./allowance";
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
it("recovers a failed dispatch after accepted usage without repeating work, acceptance or allowance consumption", async () => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_demo_only");
  vi.useFakeTimers();
  vi.setSystemTime(700000);
  const t = convexTest(schema, modules);
  t.registerComponent(
    "betterStripe",
    componentSchema,
    import.meta.glob("../../../src/component/**/*.ts"),
  );
  const actorId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Recovery",
      email: "recovery@example.invalid",
      role: "customer",
    }),
  );
  const runId = await t.mutation(internal.meteredUsage.state.begin, {
    actorId,
    model: "included_overage",
    configurationJson: JSON.stringify(demoConfiguration("included_overage")),
  });
  const f = fixture();
  const view = await t.action((ctx) =>
    ensureManagedSubscription(f.stripe, f.component, ctx as RunCtx, request),
  );
  const meter = view.bindings[0];
  await t.action((ctx) =>
    ensureDemoAllowance(ctx as RunCtx, stripe.usage, meter),
  );
  await t.mutation(internal.meteredUsage.state.saveProvider, {
    actorId,
    runId,
    providerJson: JSON.stringify({
      clockId: "clock_test",
      productId: "prod_test",
      requestId: request.requestId,
      price: {},
      meter,
    }),
  });
  const usage = stripe.usage;
  vi.spyOn(stripe, "usage", "get").mockReturnValue(usage);
  vi.spyOn(usage, "startDelivery").mockRejectedValue(
    new Error("dispatch unavailable after ledger commit"),
  );
  await expect(
    t.action(api.meteredUsage.activities.consume, {
      actorId,
      runId,
      requestId: "same-work",
      quantity: "5",
    }),
  ).rejects.toThrow(/dispatch unavailable/);
  const first = await t.query(internal.meteredUsage.state.lastActivity, {
    actorId,
    runId,
  });
  expect(first?.completedAt).toBe(700000);
  expect(first?.receiptId).toBeTruthy();
  await expect(
    t.action(api.meteredUsage.activities.replay, { actorId, runId }),
  ).rejects.toThrow(/dispatch unavailable/);
  expect(
    await t.query(internal.meteredUsage.state.lastActivity, { actorId, runId }),
  ).toEqual(first);
  const summary = await t.action((ctx) =>
    stripe.usage.getSummary(ctx as RunCtx, {
      scope: meter.scope,
      period: meter.subscription.period,
    }),
  );
  expect(summary.eventCount).toBe(1);
  expect(summary.groups[0].acceptedQuantity).toBe("5");
  const allowance = await t.action((ctx) =>
    stripe.usage.getAllowanceStatus(ctx as RunCtx, meter),
  );
  expect(allowance?.consumedQuantity).toBe("5");
  expect(allowance?.reservedQuantity).toBe("0");
});
