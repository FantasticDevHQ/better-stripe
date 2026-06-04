"use client";

import { describe, expect, it, vi } from "vitest";

import { useStripePublishableKey } from "./useStripePublishableKey.js";

const mockUseQuery = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

describe("useStripePublishableKey", () => {
  it("queries the provided Convex query reference", () => {
    const queryRef = { _name: "getStripePublishableKey" };
    mockUseQuery.mockReturnValue("pk_test_123");

    expect(useStripePublishableKey(queryRef)).toBe("pk_test_123");
    expect(mockUseQuery).toHaveBeenCalledWith(queryRef, {});
  });

  it("preserves null when the publishable key is not configured", () => {
    const queryRef = { _name: "getStripePublishableKey" };
    mockUseQuery.mockReturnValue(null);

    expect(useStripePublishableKey(queryRef)).toBeNull();
  });

  it("preserves undefined while the query is still loading", () => {
    const queryRef = { _name: "getStripePublishableKey" };
    mockUseQuery.mockReturnValue(undefined);

    expect(useStripePublishableKey(queryRef)).toBeUndefined();
  });
});
