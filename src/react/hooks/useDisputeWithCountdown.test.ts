/**
 * Tests for createUseDisputeWithCountdown — verifies the factory queries
 * getDisputeWithCountdown for a single dispute id (using Convex's "skip"
 * sentinel when the id is undefined) and maps the reactive result into
 * { dispute, countdown, isLoading }.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createUseDisputeWithCountdown } from "./useDisputeWithCountdown.js";

describe("createUseDisputeWithCountdown", () => {
  const mockQueryRef = { __brand: "queryRef" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries by stripeDisputeId and returns the dispute + countdown", () => {
    const countdown = {
      dueBy: "2026-07-10T00:00:00.000Z",
      daysRemaining: 11,
      isOverdue: false,
    };
    const mockDispute = {
      stripeDisputeId: "dp_1",
      status: "needs_response",
      countdown,
    };
    const mockUseQuery = vi.fn().mockReturnValue(mockDispute);
    const useDisputeWithCountdown = createUseDisputeWithCountdown(
      mockUseQuery,
      mockQueryRef,
    );

    const result = useDisputeWithCountdown("dp_1");

    expect(result.dispute).toBe(mockDispute);
    expect(result.countdown).toBe(countdown);
    expect(result.isLoading).toBe(false);
    expect(mockUseQuery).toHaveBeenCalledWith(mockQueryRef, {
      stripeDisputeId: "dp_1",
    });
  });

  it("reports isLoading=true while the query result is undefined", () => {
    const mockUseQuery = vi.fn().mockReturnValue(undefined);
    const useDisputeWithCountdown = createUseDisputeWithCountdown(
      mockUseQuery,
      mockQueryRef,
    );

    const result = useDisputeWithCountdown("dp_1");

    expect(result.dispute).toBeNull();
    expect(result.countdown).toBeNull();
    expect(result.isLoading).toBe(true);
    expect(mockUseQuery).toHaveBeenCalledWith(mockQueryRef, {
      stripeDisputeId: "dp_1",
    });
  });

  it("passes the 'skip' sentinel and does not load when id is undefined", () => {
    const mockUseQuery = vi.fn().mockReturnValue(undefined);
    const useDisputeWithCountdown = createUseDisputeWithCountdown(
      mockUseQuery,
      mockQueryRef,
    );

    const result = useDisputeWithCountdown(undefined);

    expect(result.dispute).toBeNull();
    expect(result.countdown).toBeNull();
    expect(result.isLoading).toBe(false);
    expect(mockUseQuery).toHaveBeenCalledWith(mockQueryRef, "skip");
  });

  it("treats a null result (dispute not found) as loaded, not loading", () => {
    const mockUseQuery = vi.fn().mockReturnValue(null);
    const useDisputeWithCountdown = createUseDisputeWithCountdown(
      mockUseQuery,
      mockQueryRef,
    );

    const result = useDisputeWithCountdown("dp_missing");

    expect(result.dispute).toBeNull();
    expect(result.countdown).toBeNull();
    expect(result.isLoading).toBe(false);
  });
});
