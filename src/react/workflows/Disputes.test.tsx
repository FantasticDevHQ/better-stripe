// @vitest-environment jsdom
import {
  act,
  cleanup,
  renderHook,
  render,
  screen,
  fireEvent,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Disputes, useDisputeResponse } from "./Disputes.js";
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

it.each(["won", "lost", "under_review"] as const)(
  "keeps %s disputes read-only",
  (status) => {
    const detail = {
      _id: "doc",
      _creationTime: 0,
      stripeDisputeId: "dp_closed",
      amount: 1000,
      currency: "usd",
      status,
      reason: "product_not_received",
      isChargeRefundable: false,
      countdown: { daysRemaining: 9, isOverdue: false },
    };
    render(
      <Disputes
        scopeKey="seller"
        disputes={[detail]}
        detail={detail}
        acceptDispute={vi.fn()}
        onUpdateEvidence={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /dp_closed/ }));
    expect(screen.queryByRole("button", { name: "Accept dispute" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Submit evidence" }),
    ).toBeNull();
    expect(screen.queryByText("Evidence due in 9 days")).toBeNull();
  },
);
