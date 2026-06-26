/**
 * Tests for the config accessors. These delegate to component queries via
 * `componentRef`, so we build a minimal fake component carrying the reference
 * symbol and assert (a) the correct ref is queried and (b) the value passes
 * straight through — including the `null` publishable-key case.
 */
import { describe, expect, it, vi } from "vitest";

import type { Component, RunCtx } from "../helpers.js";
import { getPublishableKey, getStripeMode } from "./config.js";

const TO_REF = Symbol.for("toReferencePath");

/** Minimal component proxy exposing the two core query refs config.ts touches. */
function makeComponent() {
  return {
    core: {
      queries: {
        getPublishableKey: {
          [TO_REF]: "betterStripe/core/queries/getPublishableKey",
        },
        getStripeMode: {
          [TO_REF]: "betterStripe/core/queries/getStripeMode",
        },
      },
    },
  } as unknown as Component;
}

describe("getPublishableKey", () => {
  it("queries the publishable-key ref and returns its value", async () => {
    const component = makeComponent();
    const ctx = {
      runQuery: vi.fn().mockResolvedValue("pk_test_123"),
    } as unknown as RunCtx;

    const result = await getPublishableKey(component, ctx);

    expect(result).toBe("pk_test_123");
    const [ref, args] = (ctx.runQuery as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(ref[TO_REF]).toBe("betterStripe/core/queries/getPublishableKey");
    expect(args).toEqual({});
  });

  it("returns null when no publishable key is configured", async () => {
    const component = makeComponent();
    const ctx = {
      runQuery: vi.fn().mockResolvedValue(null),
    } as unknown as RunCtx;

    expect(await getPublishableKey(component, ctx)).toBeNull();
  });
});

describe("getStripeMode", () => {
  it("queries the stripe-mode ref and returns the mode", async () => {
    const component = makeComponent();
    const ctx = {
      runQuery: vi.fn().mockResolvedValue("test"),
    } as unknown as RunCtx;

    const result = await getStripeMode(component, ctx);

    expect(result).toBe("test");
    const [ref] = (ctx.runQuery as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(ref[TO_REF]).toBe("betterStripe/core/queries/getStripeMode");
  });
});
