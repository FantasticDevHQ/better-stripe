/**
 * Tests for createUseInvoices — verifies the hook factory passes the right
 * query ref/args to useQuery and maps the reactive result into
 * { invoices, isLoading }, including the undefined/loading case.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createUseInvoices } from "./useInvoices.js";

describe("createUseInvoices", () => {
  const mockQueryRef = { __brand: "queryRef" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns invoices and isLoading=false once data is loaded", () => {
    const mockInvoices = [
      { id: "in_1", status: "paid" },
      { id: "in_2", status: "open" },
    ];
    const mockUseQuery = vi.fn().mockReturnValue(mockInvoices);
    const useInvoices = createUseInvoices(mockUseQuery, mockQueryRef);

    const result = useInvoices({ userId: "user_123" });

    expect(result.invoices).toBe(mockInvoices);
    expect(result.isLoading).toBe(false);
    expect(mockUseQuery).toHaveBeenCalledWith(mockQueryRef, {
      userId: "user_123",
    });
  });

  it("reports isLoading=true while the query result is undefined", () => {
    const mockUseQuery = vi.fn().mockReturnValue(undefined);
    const useInvoices = createUseInvoices(mockUseQuery, mockQueryRef);

    const result = useInvoices({ subscriptionId: "sub_1" });

    expect(result.invoices).toBeUndefined();
    expect(result.isLoading).toBe(true);
    expect(mockUseQuery).toHaveBeenCalledWith(mockQueryRef, {
      subscriptionId: "sub_1",
    });
  });

  it("treats an empty array as loaded, not loading", () => {
    const mockUseQuery = vi.fn().mockReturnValue([]);
    const useInvoices = createUseInvoices(mockUseQuery, mockQueryRef);

    const result = useInvoices({ status: "paid" });

    expect(result.invoices).toEqual([]);
    expect(result.isLoading).toBe(false);
  });

  it("defaults args to an empty object when called with no arguments", () => {
    const mockUseQuery = vi.fn().mockReturnValue([]);
    const useInvoices = createUseInvoices(mockUseQuery, mockQueryRef);

    useInvoices();

    expect(mockUseQuery).toHaveBeenCalledWith(mockQueryRef, {});
  });

  it("passes every filter through to useQuery verbatim", () => {
    const mockUseQuery = vi.fn().mockReturnValue([]);
    const useInvoices = createUseInvoices(mockUseQuery, mockQueryRef);

    const args = {
      userId: "user_9",
      subscriptionId: "sub_9",
      status: "open",
    };
    useInvoices(args);

    expect(mockUseQuery).toHaveBeenCalledWith(mockQueryRef, args);
  });
});
