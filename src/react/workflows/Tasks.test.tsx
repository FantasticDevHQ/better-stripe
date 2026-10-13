// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useTaskRunner } from "./Tasks.js";
afterEach(cleanup);
it("retains per-operation results and errors and keeps only a bounded activity log", async () => {
  const { result } = renderHook(() => useTaskRunner({ maxEntries: 2 }));
  await act(async () => {
    await result.current.run("Products", async () => ({ count: 3 }));
  });
  expect(result.current.results.Products).toBe("Completed");
  await act(async () => {
    await result.current.run("Accounts", async () => {
      throw new Error("Restricted");
    });
  });
  expect(result.current.errors.Accounts).toBe("Restricted");
  await act(async () => {
    await result.current.run("Subscriptions", async () => null);
  });
  expect(result.current.log).toHaveLength(2);
  expect(result.current.results.Products).toBe("Completed");
});
