// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.*s");

// Both keys are declared in the component environment and passed by the app.
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
  it("getPublishableKey: returns the configured test publishable key", async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_abc123";
    const t = convexTest(schema, modules);
    expect(await t.query(api.core.queries.getPublishableKey, {})).toBe(
      "pk_test_abc123",
    );
  });
});
