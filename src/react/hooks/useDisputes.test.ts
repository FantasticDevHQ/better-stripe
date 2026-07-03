/**
 * Tests for createUseDisputes — verifies the hook factory passes the right
 * query ref/args (account + status filters) to useQuery and maps the reactive
 * result into { disputes, isLoading }, including the undefined/loading case.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createUseDisputes } from "./useDisputes.js";

describe("createUseDisputes", () => {
  const mockQueryRef = { __brand: "queryRef" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns disputes and isLoading=false once data is loaded", () => {
    const mockDisputes = [
      { stripeDisputeId: "dp_1", status: "needs_response" },
      { stripeDisputeId: "dp_2", status: "won" },
    ];
    const mockUseQuery = vi.fn().mockReturnValue(mockDisputes);
    const useDisputes = createUseDisputes(mockUseQuery, mockQueryRef);

    const result = useDisputes({ accountId: "acct_123" });

    expect(result.disputes).toBe(mockDisputes);
    expect(result.isLoading).toBe(false);
    expect(mockUseQuery).toHaveBeenCalledWith(mockQueryRef, {
      accountId: "acct_123",
    });
  });

  it("reports isLoading=true while the query result is undefined", () => {
    const mockUseQuery = vi.fn().mockReturnValue(undefined);
    const useDisputes = createUseDisputes(mockUseQuery, mockQueryRef);

    const result = useDisputes({ status: "needs_response" });

    expect(result.disputes).toBeUndefined();
    expect(result.isLoading).toBe(true);
    expect(mockUseQuery).toHaveBeenCalledWith(mockQueryRef, {
      status: "needs_response",
    });
  });

  it("treats an empty array as loaded, not loading", () => {
    const mockUseQuery = vi.fn().mockReturnValue([]);
    const useDisputes = createUseDisputes(mockUseQuery, mockQueryRef);

    const result = useDisputes({ accountId: "acct_1", status: "won" });

    expect(result.disputes).toEqual([]);
    expect(result.isLoading).toBe(false);
  });

  it("defaults args to an empty object when called with no arguments", () => {
    const mockUseQuery = vi.fn().mockReturnValue([]);
    const useDisputes = createUseDisputes(mockUseQuery, mockQueryRef);

    useDisputes();

    expect(mockUseQuery).toHaveBeenCalledWith(mockQueryRef, {});
  });

  it("passes the account + status filters through to useQuery verbatim", () => {
    const mockUseQuery = vi.fn().mockReturnValue([]);
    const useDisputes = createUseDisputes(mockUseQuery, mockQueryRef);

    const args = { accountId: "acct_9", status: "needs_response" };
    useDisputes(args);

    expect(mockUseQuery).toHaveBeenCalledWith(mockQueryRef, args);
  });
});
