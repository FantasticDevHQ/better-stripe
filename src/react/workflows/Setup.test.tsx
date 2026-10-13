// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useWebhookSetup } from "./Setup.js";
afterEach(cleanup);
it("refreshes destination status after setup and keeps setup errors available for retry", async () => {
  const load = vi
    .fn()
    .mockResolvedValueOnce({ configured: false })
    .mockResolvedValueOnce({ configured: true });
  const setup = vi.fn().mockResolvedValue({ id: "we_test" });
  const { result } = renderHook(() =>
    useWebhookSetup({ scopeKey: "site", load, setup }),
  );
  await waitFor(() =>
    expect(result.current.status).toEqual({ configured: false }),
  );
  await act(async () => {
    await result.current.configure();
  });
  await waitFor(() =>
    expect(result.current.status).toEqual({ configured: true }),
  );
  expect(result.current.result).toEqual({ id: "we_test" });
});
