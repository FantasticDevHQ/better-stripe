// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.*s");

// These queries read the component's Stripe env vars. `STRIPE_SECRET_KEY` is
// declared (required) in `convex.config.ts`; `STRIPE_PUBLISHABLE_KEY` is
// intentionally NOT declared (it is a frontend-only value), so the component
// never receives it and `getPublishableKey` always resolves to null.
describe("core/queries — Stripe config from declared env", () => {
  const originalSecret = process.env.STRIPE_SECRET_KEY;
  const originalPublishable = process.env.STRIPE_PUBLISHABLE_KEY;

  beforeEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PUBLISHABLE_KEY;
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = originalSecret;
    if (originalPublishable === undefined)
      delete process.env.STRIPE_PUBLISHABLE_KEY;
    else process.env.STRIPE_PUBLISHABLE_KEY = originalPublishable;
  });

  it("getStripeMode: returns 'test' for a test secret key", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_abc123";
    const t = convexTest(schema, modules);
    expect(await t.query(api.core.queries.getStripeMode, {})).toBe("test");
  });

  it("getStripeMode: returns 'live' for a live secret key", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_abc123";
    const t = convexTest(schema, modules);
    expect(await t.query(api.core.queries.getStripeMode, {})).toBe("live");
  });

  it("getPublishableKey: returns null when the var is not provided to the component", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.core.queries.getPublishableKey, {})).toBeNull();
  });
});
