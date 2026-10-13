// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useAccountManager } from "./Account.js";
afterEach(cleanup);
it("opens an authorized dashboard link and exposes configuration failures", async () => {
  const navigate = vi.fn();
  const configure = vi
    .fn()
    .mockRejectedValue(new Error("Capability unavailable"));
  const { result } = renderHook(() =>
    useAccountManager({
      scopeKey: "acct_one",
      createDashboardLink: async () => ({
        url: "https://connect.stripe.com/dashboard",
      }),
      configure,
      onNavigate: navigate,
    }),
  );
  await act(async () => {
    await result.current.openDashboard();
  });
  expect(navigate).toHaveBeenCalledWith("https://connect.stripe.com/dashboard");
  await act(async () => {
    await result.current.configure("merchant");
  });
  expect(configure).toHaveBeenCalledWith("merchant");
  expect(result.current.error).toBe("Capability unavailable");
  expect(result.current.lastConfiguration).toBe("merchant");
});
