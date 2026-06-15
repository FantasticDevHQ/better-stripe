/**
 * Tests for createUseAccountOnboarding — verifies the hook factory
 * returns correct isReady/status/missingRequirements based on account data.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createUseAccountOnboarding } from "./useAccountOnboarding.js";

describe("createUseAccountOnboarding", () => {
  const mockQueryRef = { __brand: "queryRef" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns isReady=true when onboardingStatus is complete", () => {
    const mockAccount = {
      onboardingStatus: "complete",
      missingRequirements: [],
    };
    const mockUseQuery = vi.fn().mockReturnValue(mockAccount);
    const useAccountOnboarding = createUseAccountOnboarding(
      mockUseQuery,
      mockQueryRef,
    );
    const result = useAccountOnboarding("acct_123");
    expect(result.isReady).toBe(true);
    expect(result.status).toBe("complete");
    expect(result.isLoading).toBe(false);
    expect(result.account).toBe(mockAccount);
    expect(mockUseQuery).toHaveBeenCalledWith(mockQueryRef, {
      accountId: "acct_123",
    });
  });

  it.each(["pending", "in_progress", "restricted"])(
    "returns isReady=false for %s status",
    (status) => {
      const mockAccount = {
        onboardingStatus: status,
        missingRequirements: [],
      };
      const mockUseQuery = vi.fn().mockReturnValue(mockAccount);
      const useAccountOnboarding = createUseAccountOnboarding(
        mockUseQuery,
        mockQueryRef,
      );
      const result = useAccountOnboarding("acct_456");
      expect(result.isReady).toBe(false);
      expect(result.status).toBe(status);
      expect(result.isLoading).toBe(false);
    },
  );

  it("exposes missing requirements from account doc", () => {
    const requirements = [
      "individual.verification.document",
      "business_profile.url",
      "external_account",
    ];
    const mockAccount = {
      onboardingStatus: "in_progress",
      missingRequirements: requirements,
    };
    const mockUseQuery = vi.fn().mockReturnValue(mockAccount);
    const useAccountOnboarding = createUseAccountOnboarding(
      mockUseQuery,
      mockQueryRef,
    );
    const result = useAccountOnboarding("acct_789");
    expect(result.missingRequirements).toEqual(requirements);
    expect(result.missingRequirements).toHaveLength(3);
    expect(result.isReady).toBe(false);
  });
});
