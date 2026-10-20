import { convexTest } from "convex-test";
import { beforeEach, expect, it, vi } from "vitest";

import { modules } from "../../test";
import { api } from "../_generated/api";

const calls = vi.hoisted(() => ({
  updateProduct: vi.fn(),
  deactivateProduct: vi.fn(),
}));
vi.mock("../stripe/helpers", () => ({ stripe: calls }));

beforeEach(() => {
  vi.clearAllMocks();
  calls.updateProduct.mockResolvedValue({ success: true });
  calls.deactivateProduct.mockResolvedValue({ success: true });
});

it("validates and forwards the caller's update key through the registered example action", async () => {
  const t = convexTest(undefined, modules);
  const args = {
    stripeProductId: "prod_original",
    name: "Updated name",
    idempotencyKey: "catalog:update:original",
  };
  expect(await t.action(api.products.actions.updateProduct, args)).toEqual({
    success: true,
  });
  expect(calls.updateProduct).toHaveBeenCalledExactlyOnceWith(
    expect.anything(),
    args,
  );
});

it("validates and forwards the caller's deactivate key through the registered example action", async () => {
  const t = convexTest(undefined, modules);
  const args = {
    stripeProductId: "prod_original",
    idempotencyKey: "catalog:archive:original",
  };
  expect(await t.action(api.products.actions.deactivateProduct, args)).toEqual({
    success: true,
  });
  expect(calls.deactivateProduct).toHaveBeenCalledExactlyOnceWith(
    expect.anything(),
    args,
  );
});

it("keeps existing registered action callers valid without a key", async () => {
  const t = convexTest(undefined, modules);
  await t.action(api.products.actions.updateProduct, {
    stripeProductId: "prod_original",
    name: "Unkeyed",
  });
  await t.action(api.products.actions.deactivateProduct, {
    stripeProductId: "prod_original",
  });
  expect(calls.updateProduct.mock.calls[0]?.[1]).toEqual({
    stripeProductId: "prod_original",
    name: "Unkeyed",
  });
  expect(calls.deactivateProduct.mock.calls[0]?.[1]).toEqual({
    stripeProductId: "prod_original",
  });
});
