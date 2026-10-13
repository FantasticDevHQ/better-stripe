// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePaymentMethodsManager } from "./PaymentMethods.js";
afterEach(cleanup);
it("refreshes saved methods after a successful attach and reports detach failures", async () => {
  const load = vi
    .fn()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ id: "pm_one", type: "card" }]);
  const attach = vi.fn().mockResolvedValue(null);
  const detach = vi.fn().mockRejectedValue(new Error("Card is still in use"));
  const { result } = renderHook(() =>
    usePaymentMethodsManager({ scopeKey: "buyer", load, attach, detach }),
  );
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  await act(async () => {
    await result.current.attach("pm_one");
  });
  await waitFor(() => expect(result.current.methods).toHaveLength(1));
  expect(attach).toHaveBeenCalledWith("pm_one");
  await act(async () => {
    await result.current.detach("pm_one");
  });
  expect(result.current.deleteError).toBe("Card is still in use");
  expect(result.current.methods).toHaveLength(1);
});
it("keeps a pending detach error associated with detach when another action is attempted", async () => {
  let reject!: (error: Error) => void;
  const detach = vi.fn(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  const attach = vi.fn();
  const { result } = renderHook(() =>
    usePaymentMethodsManager({
      scopeKey: "buyer",
      load: async () => [],
      attach,
      detach,
    }),
  );
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.detach("pm_one");
  });
  await act(async () => {
    await result.current.attach("pm_two");
  });
  expect(attach).not.toHaveBeenCalled();
  await act(async () => {
    reject(new Error("Detach failed"));
    await pending;
  });
  expect(result.current.deleteError).toBe("Detach failed");
  expect(result.current.attachError).toBeNull();
});
