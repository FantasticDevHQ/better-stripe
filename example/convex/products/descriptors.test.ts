import { convexTest } from "convex-test";
import { beforeEach, expect, it, vi } from "vitest";

import { modules } from "../../test";
import { api } from "../_generated/api";

const calls = vi.hoisted(() => ({
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
}));
vi.mock("../stripe/helpers", () => ({ stripe: calls }));
beforeEach(() => {
  vi.clearAllMocks();
  calls.createProduct.mockResolvedValue({
    stripeProductId: "prod_original",
    productId: "component_original",
  });
  calls.updateProduct.mockResolvedValue({ success: true });
});

it.each(["COMMUNITY ONE", null])(
  "forwards create descriptor %j and stable key through the registered example action",
  async (statementDescriptor) => {
    const t = convexTest(undefined, modules);
    const args = {
      name: "Original",
      statementDescriptor,
      idempotencyKey: "descriptor:original",
    };
    expect(await t.action(api.products.actions.createProduct, args)).toEqual({
      stripeProductId: "prod_original",
      productId: "component_original",
    });
    expect(calls.createProduct).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      args,
    );
  },
);
it.each(["COMMUNITY ONE", null])(
  "forwards update descriptor %j and stable key through the registered example action",
  async (statementDescriptor) => {
    const t = convexTest(undefined, modules);
    const args = {
      stripeProductId: "prod_original",
      statementDescriptor,
      idempotencyKey: "descriptor:original",
    };
    expect(await t.action(api.products.actions.updateProduct, args)).toEqual({
      success: true,
    });
    expect(calls.updateProduct).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      args,
    );
  },
);
it("preserves existing action callers without descriptor or key", async () => {
  const t = convexTest(undefined, modules);
  await t.action(api.products.actions.createProduct, { name: "Original" });
  await t.action(api.products.actions.updateProduct, {
    stripeProductId: "prod_original",
  });
  expect(calls.createProduct.mock.calls[0]?.[1]).toEqual({ name: "Original" });
  expect(calls.updateProduct.mock.calls[0]?.[1]).toEqual({
    stripeProductId: "prod_original",
  });
});
