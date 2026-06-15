/**
 * Tests for assertTestEnvironment — guards against running test fixtures
 * with live Stripe API keys.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { assertTestEnvironment } from "./assert-test-env";

describe("assertTestEnvironment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws for sk_live_ keys", () => {
    expect(() => assertTestEnvironment("sk_live_abc123")).toThrowError(
      "REFUSING",
    );
  });

  it("validates sk_test_ keys without error", () => {
    expect(() => assertTestEnvironment("sk_test_abc123")).not.toThrow();
  });

  it("throws when no key provided and env var is empty", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect(() => assertTestEnvironment()).toThrowError("not set");
  });

  it("throws when no key provided and env var is undefined", () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect(() => assertTestEnvironment()).toThrowError("not set");
  });
});
