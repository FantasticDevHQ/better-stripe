import { describe, expect, it, vi } from "vitest";

import { STRIPE_API_VERSION } from "./constants.js";
import { epochToIso, getStripeClient, runMutationOrThrow } from "./helpers.js";

describe("STRIPE_API_VERSION", () => {
  it("is a dahlia API version", () => {
    expect(STRIPE_API_VERSION).toMatch(/\.dahlia$/);
  });
});

describe("epochToIso", () => {
  it("converts epoch seconds to ISO string", () => {
    expect(epochToIso(1704067200)).toBe("2024-01-01T00:00:00.000Z");
  });

  it("returns undefined for null", () => {
    expect(epochToIso(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(epochToIso(undefined)).toBeUndefined();
  });
});

describe("getStripeClient", () => {
  it("returns a Stripe instance", () => {
    const client = getStripeClient("sk_test_xxx");
    expect(client).toBeDefined();
    expect(typeof client.checkout).toBe("object");
  });

  it("caches instances by secret key and API version", () => {
    // Same key and version should return the same cached instance
    const client1 = getStripeClient("sk_test_abc");
    const client2 = getStripeClient("sk_test_abc");
    expect(client1).toBe(client2);
  });

  it("caches instances separately by API version", () => {
    // Same key but different versions should return different instances
    const client1 = getStripeClient("sk_test_def", "2026-05-27.dahlia");
    const client2 = getStripeClient("sk_test_def", "2026-01-01.dahlia");
    expect(client1).not.toBe(client2);
  });

  it("caches instances separately by secret key", () => {
    // Different keys should return different instances
    const client1 = getStripeClient("sk_test_key1");
    const client2 = getStripeClient("sk_test_key2");
    expect(client1).not.toBe(client2);
  });
});

describe("runMutationOrThrow", () => {
  it("throws when runMutation is not available", async () => {
    const ctx = { runQuery: vi.fn() };
    const ref = {} as any;
    await expect(runMutationOrThrow(ctx, ref, {})).rejects.toThrow(
      "runMutation",
    );
  });

  it("calls runMutation and returns result", async () => {
    const ctx = {
      runQuery: vi.fn(),
      runMutation: vi.fn().mockResolvedValue("result"),
    };
    const ref = {} as any;
    const result = await runMutationOrThrow(ctx, ref, { foo: "bar" });
    expect(result).toBe("result");
    expect(ctx.runMutation).toHaveBeenCalledWith(ref, { foo: "bar" });
  });
});
