// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useWorkflowResource } from "./useWorkflowResource.js";
afterEach(cleanup);
it("initializes only once in StrictMode and permits an explicit retry", async () => {
  const load = vi
    .fn()
    .mockRejectedValueOnce(new Error("Unavailable"))
    .mockResolvedValueOnce("fresh");
  const { result } = renderHook(() => useWorkflowResource(load), {
    wrapper: StrictMode,
  });
  await waitFor(() => expect(result.current.error).toBe("Unavailable"));
  expect(load).toHaveBeenCalledOnce();
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.data).toBe("fresh"));
  expect(load).toHaveBeenCalledTimes(2);
});
it("ignores an old account's response and loads new account data", async () => {
  let resolve!: (value: string) => void;
  const load = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValueOnce("new balance");
  const { result, rerender } = renderHook(
    ({ scope }) => useWorkflowResource(load, scope),
    { initialProps: { scope: "one" } },
  );
  await waitFor(() => expect(load).toHaveBeenCalledOnce());
  rerender({ scope: "two" });
  await waitFor(() => expect(result.current.data).toBe("new balance"));
  await act(async () => resolve("old balance"));
  expect(result.current.data).toBe("new balance");
});
