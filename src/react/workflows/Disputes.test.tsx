// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useDisputeResponse } from "./Disputes.js";
afterEach(cleanup);
it("requires explicit confirmation and clears it when selecting another dispute", async () => {
  const acceptDispute = vi.fn().mockResolvedValue(null);
  const { result } = renderHook(() =>
    useDisputeResponse({ scopeKey: "seller", acceptDispute }),
  );
  act(() => result.current.setSelectedId("dp_one"));
  await act(async () => {
    await result.current.accept();
  });
  expect(acceptDispute).not.toHaveBeenCalled();
  act(() => result.current.requestAccept());
  act(() => result.current.setSelectedId("dp_two"));
  expect(result.current.acceptStatus).toBe("idle");
  act(() => result.current.requestAccept());
  await act(async () => {
    await result.current.accept();
  });
  expect(acceptDispute).toHaveBeenCalledWith("dp_two");
  expect(result.current.acceptStatus).toBe("accepted");
});
