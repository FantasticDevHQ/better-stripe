/**
 * Tests for createUseProducts — verifies the hook factory passes the right
 * query ref/args to useQuery and maps the reactive result into
 * { products, isLoading }, including the undefined/loading case.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createUseProducts } from "./useProducts.js";

describe("createUseProducts", () => {
  const mockQueryRef = { __brand: "queryRef" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns products and isLoading=false once data is loaded", () => {
    const mockProducts = [
      { id: "prod_1", active: true },
      { id: "prod_2", active: false },
    ];
    const mockUseQuery = vi.fn().mockReturnValue(mockProducts);
    const useProducts = createUseProducts(mockUseQuery, mockQueryRef);

    const result = useProducts({ accountId: "acct_123" });

    expect(result.products).toBe(mockProducts);
    expect(result.isLoading).toBe(false);
    expect(mockUseQuery).toHaveBeenCalledWith(mockQueryRef, {
      accountId: "acct_123",
    });
  });

  it("reports isLoading=true while the query result is undefined", () => {
    const mockUseQuery = vi.fn().mockReturnValue(undefined);
    const useProducts = createUseProducts(mockUseQuery, mockQueryRef);

    const result = useProducts({ active: true });

    expect(result.products).toBeUndefined();
    expect(result.isLoading).toBe(true);
    expect(mockUseQuery).toHaveBeenCalledWith(mockQueryRef, {
      active: true,
    });
  });

  it("treats an empty array as loaded, not loading", () => {
    const mockUseQuery = vi.fn().mockReturnValue([]);
    const useProducts = createUseProducts(mockUseQuery, mockQueryRef);

    const result = useProducts({ active: false });

    expect(result.products).toEqual([]);
    expect(result.isLoading).toBe(false);
  });

  it("defaults args to an empty object when called with no arguments", () => {
    const mockUseQuery = vi.fn().mockReturnValue([]);
    const useProducts = createUseProducts(mockUseQuery, mockQueryRef);

    useProducts();

    expect(mockUseQuery).toHaveBeenCalledWith(mockQueryRef, {});
  });

  it("passes accountId and active filters through to useQuery verbatim", () => {
    const mockUseQuery = vi.fn().mockReturnValue([]);
    const useProducts = createUseProducts(mockUseQuery, mockQueryRef);

    const args = { accountId: "acct_9", active: true };
    useProducts(args);

    expect(mockUseQuery).toHaveBeenCalledWith(mockQueryRef, args);
  });
});
