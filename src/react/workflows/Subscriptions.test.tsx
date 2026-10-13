// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSubscriptionManager } from "./Subscriptions.js";
afterEach(cleanup);
it("validates quantity changes and exposes server confirmation as pending webhook synchronization", async () => {
  const onAction = vi.fn().mockResolvedValue(null);
  const { result } = renderHook(() =>
    useSubscriptionManager({
      scopeKey: "buyer",
      subscription: { stripeSubscriptionId: "sub_one", status: "active" },
      onAction,
    }),
  );
  act(() => result.current.setQuantity("1.5"));
  await act(async () => {
    await result.current.run("quantity");
  });
  expect(onAction).not.toHaveBeenCalled();
  expect(result.current.message).toContain("integer");
  act(() => result.current.setQuantity("3"));
  await act(async () => {
    await result.current.run("quantity");
  });
  expect(onAction).toHaveBeenCalledWith({
    type: "quantity",
    stripeSubscriptionId: "sub_one",
    quantity: 3,
  });
  expect(result.current.message).toContain("Waiting for Stripe webhook sync");
});

it("retains the pending subscription action when a second action is attempted", async () => {
  let finish!: () => void;
  const onAction = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const { result } = renderHook(() =>
    useSubscriptionManager({
      scopeKey: "buyer",
      subscription: { stripeSubscriptionId: "sub_one", status: "active" },
      onAction,
    }),
  );
  let pending!: Promise<unknown>;
  act(() => {
    pending = result.current.run("pause");
  });
  await act(async () => {
    await result.current.run("cancel");
  });
  expect(result.current.pendingAction).toBe("pause subscription");
  expect(onAction).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish();
    await pending;
  });
});
