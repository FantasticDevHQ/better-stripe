// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Products, useProductManager } from "./Products.js";
afterEach(cleanup);
it("supports editing and archiving without advertising creation capabilities", async () => {
  const updateProduct = vi.fn().mockResolvedValue(null);
  const deactivateProduct = vi.fn().mockResolvedValue(null);
  render(
    <Products
      scopeKey="owner"
      products={[
        {
          stripeProductId: "prod_original",
          name: "Original plan",
          active: true,
          prices: [],
        },
      ]}
      updateProduct={updateProduct}
      deactivateProduct={deactivateProduct}
    />,
  );
  expect(screen.queryByRole("button", { name: "Create product" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Add price" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Edit product" }));
  fireEvent.change(screen.getByLabelText("Product name"), {
    target: { value: "Updated plan" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save product" }));
  });
  expect(updateProduct).toHaveBeenCalledWith({
    stripeProductId: "prod_original",
    name: "Updated plan",
    description: undefined,
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Archive product" }));
  });
  expect(deactivateProduct).toHaveBeenCalledWith({
    stripeProductId: "prod_original",
  });
  expect(updateProduct).toHaveBeenCalledTimes(1);
});

it("reports unavailable creation without calling a different capability", async () => {
  const updateProduct = vi.fn();
  const { result } = renderHook(() =>
    useProductManager({ scopeKey: "owner", updateProduct }),
  );
  act(() =>
    result.current.setNewProduct({ name: "Original plan", description: "" }),
  );
  await act(async () => {
    await result.current.handleCreateProduct();
  });
  expect(result.current.error).toBe("Product creation is not configured.");
  expect(result.current.newProduct.name).toBe("Original plan");
  expect(updateProduct).not.toHaveBeenCalled();
  act(() =>
    result.current.setNewPrice({
      amount: "1500",
      currency: "usd",
      interval: "month",
    }),
  );
  await act(async () => {
    await result.current.handleAddPrice("prod_original");
  });
  expect(result.current.error).toBe("Price creation is not configured.");
  expect(result.current.newPrice.amount).toBe("1500");
  expect(updateProduct).not.toHaveBeenCalled();
});

it("allows product creation without exposing price creation", async () => {
  const createProduct = vi.fn().mockResolvedValue("prod_new");
  render(
    <Products
      scopeKey="product-editor"
      createProduct={createProduct}
      products={[
        {
          stripeProductId: "prod_original",
          name: "Original plan",
          active: true,
          prices: [],
        },
      ]}
    />,
  );
  expect(screen.queryByRole("button", { name: "Add price" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Product name"), {
    target: { value: "  New plan  " },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Create product" }));
  });
  expect(createProduct).toHaveBeenCalledWith({
    name: "New plan",
    description: undefined,
  });
});

it("allows price creation without exposing product creation", async () => {
  const createPrice = vi.fn().mockResolvedValue("price_new");
  render(
    <Products
      scopeKey="price-editor"
      createPrice={createPrice}
      products={[
        {
          stripeProductId: "prod_original",
          name: "Original plan",
          active: true,
          prices: [],
        },
      ]}
    />,
  );
  expect(screen.queryByRole("button", { name: "Create product" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Add price" }));
  fireEvent.change(screen.getByLabelText("Price in minor units"), {
    target: { value: "1500" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Create price" }));
  });
  expect(createPrice).toHaveBeenCalledWith({
    stripeProductId: "prod_original",
    unitAmount: 1500,
    currency: "usd",
    type: "recurring",
    interval: "month",
  });
});

it("hides an open price form when creation becomes unavailable", () => {
  const products = [
    {
      stripeProductId: "prod_original",
      name: "Original plan",
      active: true,
      prices: [],
    },
  ];
  const createPrice = vi.fn();
  const { rerender } = render(
    <Products scopeKey="owner" products={products} createPrice={createPrice} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Add price" }));
  expect(screen.getByLabelText("Price in minor units")).toBeDefined();
  rerender(<Products scopeKey="owner" products={products} />);
  expect(screen.queryByLabelText("Price in minor units")).toBeNull();
  expect(screen.queryByRole("button", { name: "Add price" })).toBeNull();
  expect(createPrice).not.toHaveBeenCalled();
});

it("keeps the new scope's draft after an old creation finishes", async () => {
  let finish!: () => void;
  const createProduct = () =>
    new Promise<void>((resolve) => {
      finish = resolve;
    });
  const { result, rerender } = renderHook(
    ({ scopeKey }) => useProductManager({ scopeKey, createProduct }),
    { initialProps: { scopeKey: "original-owner" } },
  );
  act(() =>
    result.current.setNewProduct({ name: "Original draft", description: "" }),
  );
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.handleCreateProduct();
  });
  rerender({ scopeKey: "new-owner" });
  act(() =>
    result.current.setNewProduct({
      name: "New owner's draft",
      description: "",
    }),
  );
  await act(async () => {
    finish();
    await pending;
  });
  expect(result.current.newProduct.name).toBe("New owner's draft");
  expect(result.current.error).toBeNull();
});

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
