// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useProductManager } from "./Products.js";
afterEach(cleanup);
it("validates product names and price minor units before mutation", async () => {
  const createProduct = vi.fn().mockResolvedValue("prod_test");
  const createPrice = vi.fn().mockResolvedValue("price_test");
  const { result } = renderHook(() =>
    useProductManager({ scopeKey: "seller", createProduct, createPrice }),
  );
  await act(async () => {
    await result.current.handleCreateProduct();
  });
  expect(createProduct).not.toHaveBeenCalled();
  act(() =>
    result.current.setNewProduct({
      name: "  Classic Tee  ",
      description: "Cotton",
    }),
  );
  await act(async () => {
    await result.current.handleCreateProduct();
  });
  expect(createProduct).toHaveBeenCalledWith({
    name: "Classic Tee",
    description: "Cotton",
  });
  act(() =>
    result.current.setNewPrice({
      amount: "12.50",
      currency: "usd",
      interval: "one_time",
    }),
  );
  await act(async () => {
    await result.current.handleAddPrice("prod_test");
  });
  expect(createPrice).not.toHaveBeenCalled();
  act(() =>
    result.current.setNewPrice({
      amount: "2900",
      currency: "usd",
      interval: "one_time",
    }),
  );
  await act(async () => {
    await result.current.handleAddPrice("prod_test");
  });
  expect(createPrice).toHaveBeenCalledWith({
    stripeProductId: "prod_test",
    unitAmount: 2900,
    currency: "usd",
    type: "one_time",
    interval: undefined,
  });
});

it("keeps the active product operation when a second operation is attempted", async () => {
  let finish!: () => void;
  const deactivateProduct = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const deactivatePrice = vi.fn();
  const { result } = renderHook(() =>
    useProductManager({
      scopeKey: "seller",
      createProduct: async () => null,
      createPrice: async () => null,
      deactivateProduct,
      deactivatePrice,
    }),
  );
  let pending!: Promise<unknown>;
  act(() => {
    pending = result.current.handleDeactivate("prod_one");
  });
  await act(async () => {
    await result.current.handleDeactivatePrice("price_one");
  });
  expect(result.current.deactivatingId).toBe("prod_one");
  expect(deactivatePrice).not.toHaveBeenCalled();
  await act(async () => {
    finish();
    await pending;
  });
});
