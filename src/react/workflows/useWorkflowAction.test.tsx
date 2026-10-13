// @vitest-environment jsdom
import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useWorkflowAction } from "./useWorkflowAction.js";
afterEach(cleanup);
it("prevents duplicate requests and exposes pending, errors, and retry", async () => {
  let reject!: (error: Error) => void;
  const callback = vi.fn(
    () =>
      new Promise<string>((_resolve, fail) => {
        reject = fail;
      }),
  );
  const { result } = renderHook(() => useWorkflowAction(callback));
  let first!: Promise<string | undefined>;
  act(() => {
    first = result.current.run();
  });
  expect(result.current.isPending).toBe(true);
  await act(async () => {
    await result.current.run();
  });
  expect(callback).toHaveBeenCalledOnce();
  await act(async () => {
    reject(new Error("Stripe declined"));
    await first;
  });
  expect(result.current.error).toBe("Stripe declined");
  expect(result.current.isPending).toBe(false);
});
it("does not publish an old account's action result after a scope change", async () => {
  let resolve!: (value: string) => void;
  const callback = vi.fn(
    () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
  );
  const { result, rerender } = renderHook(
    ({ scope }) => useWorkflowAction(callback, scope),
    { initialProps: { scope: "seller_one" } },
  );
  let request!: Promise<string | undefined>;
  act(() => {
    request = result.current.run();
  });
  rerender({ scope: "seller_two" });
  await act(async () => {
    resolve("seller_one_secret");
    await request;
  });
  expect(result.current.result).toBeUndefined();
  expect(result.current.isPending).toBe(false);
});
