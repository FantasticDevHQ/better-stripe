import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_API_VERSION,
  epochToIso,
  getStripeClient,
  runMutationOrThrow,
} from "./helpers.js";

describe("DEFAULT_API_VERSION", () => {
  it("is a dahlia API version", () => {
    expect(DEFAULT_API_VERSION).toMatch(/\.dahlia$/);
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
