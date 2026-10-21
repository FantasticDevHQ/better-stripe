import { convexTest } from "convex-test";
import { beforeEach, expect, it, vi } from "vitest";

import { modules } from "../../test";
import { api } from "../_generated/api";

const calls = vi.hoisted(() => ({ updateProduct: vi.fn() }));
vi.mock("../stripe/helpers", () => ({ stripe: calls }));
beforeEach(() => {
  vi.clearAllMocks();
  calls.updateProduct.mockResolvedValue({ success: true });
});

it.each([false, true, undefined])(
  "forwards optional inheritance %j through the actual registered action",
  async (inheritStatementDescriptor) => {
    const t = convexTest(undefined, modules);
    const input = {
      stripeProductId: "prod_original",
      name: "Original edit",
      idempotencyKey: "descriptor-omission:original",
      ...(inheritStatementDescriptor === undefined
        ? {}
        : { inheritStatementDescriptor }),
    };
    expect(await t.action(api.products.actions.updateProduct, input)).toEqual({
      success: true,
    });
    expect(calls.updateProduct).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      input,
    );
  },
);

it.each(["EXPLICIT STORE", null])(
  "preserves explicit %j with the false inheritance flag at the adapter boundary",
  async (statementDescriptor) => {
    const t = convexTest(undefined, modules);
    const input = {
      stripeProductId: "prod_original",
      inheritStatementDescriptor: false,
      statementDescriptor,
    };
    await t.action(api.products.actions.updateProduct, input);
    expect(calls.updateProduct).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      input,
    );
  },
);

it("rejects the wrong inheritance type before invoking the SDK", async () => {
  const t = convexTest(undefined, modules);
  const input = {
    stripeProductId: "prod_original",
    inheritStatementDescriptor: "false",
  };
  await expect(
    // @ts-expect-error Intentional invalid boolean tests runtime validation.
    t.action(api.products.actions.updateProduct, input),
  ).rejects.toThrow();
  expect(calls.updateProduct).not.toHaveBeenCalled();
});
