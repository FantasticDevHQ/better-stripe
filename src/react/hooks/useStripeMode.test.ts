/**
 * Tests for useStripeMode — verifies the hook calls Convex's useQuery with the
 * given ref and empty args, and returns the resolved StripeMode (or undefined
 * while loading). The real convex/react useQuery is mocked so no provider/DOM
 * is required.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const useQueryMock = vi.fn();
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

import { useStripeMode } from "./useStripeMode.js";

describe("useStripeMode", () => {
  const mockQueryRef = { __brand: "queryRef" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls useQuery with the supplied ref and empty args", () => {
    useQueryMock.mockReturnValue("test");

    useStripeMode(mockQueryRef);

    expect(useQueryMock).toHaveBeenCalledWith(mockQueryRef, {});
  });

  it.each(["test", "live"] as const)(
    "returns the resolved %s mode",
    (mode) => {
      useQueryMock.mockReturnValue(mode);

      const result = useStripeMode(mockQueryRef);

      expect(result).toBe(mode);
    },
  );

  it("returns undefined while the query is still loading", () => {
    useQueryMock.mockReturnValue(undefined);

    const result = useStripeMode(mockQueryRef);

    expect(result).toBeUndefined();
  });
});
