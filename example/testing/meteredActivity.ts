import { convexTest } from "convex-test";
import { vi } from "vitest";
import { modules } from "../test";
import schema from "../convex/schema";
import componentSchema from "../../src/component/schema.js";
import { fixture } from "../../src/client/usage/subscriptionTransport.fixtures.js";
import { request } from "../../src/client/usage/subscription.fixtures.js";
import { ensureManagedSubscription } from "../../src/client/usage/subscriptionProvider.js";
import type { RunCtx } from "../../src/client/helpers.js";
import { internal } from "../convex/_generated/api";
import { stripe } from "../convex/stripe/helpers";
import { demoConfiguration } from "../convex/meteredUsage/policy";
import { ensureDemoAllowance } from "../convex/meteredUsage/allowance";
/** Failure-injection setup only. Native billing acceptance uses the real sandbox separately. */
export async function activityFixture() {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_demo_only");
  vi.useFakeTimers();
  vi.setSystemTime(700000);
  const t = convexTest(schema, modules);
  t.registerComponent(
    "betterStripe",
    componentSchema,
    import.meta.glob("../../src/component/**/*.ts"),
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
  return { t, actorId, runId, meter };
}
