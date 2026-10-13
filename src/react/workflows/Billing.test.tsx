// @vitest-environment jsdom
import {
  act,
  cleanup,
  renderHook,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { useBalanceFunding, InvoiceEstimate } from "./Billing.js";
afterEach(cleanup);
it("requires explicit consent before enabling balance payments", async () => {
  const change = vi.fn().mockResolvedValue(null);
  const { result } = renderHook(() =>
    useBalanceFunding({ scopeKey: "seller", change }),
  );
  await act(async () => {
    await result.current.confirm(true);
  });
  expect(change).not.toHaveBeenCalled();
  expect(result.current.error).toContain("consent");
  act(() => result.current.setConsent(true));
  await act(async () => {
    await result.current.confirm(true);
  });
  expect(change).toHaveBeenCalledWith({ enabled: true, consent: true });
  expect(result.current.consent).toBe(false);
});
it("loads an itemized estimate only when requested and displays the server total", async () => {
  const load = vi.fn().mockResolvedValue({
    currency: "usd",
    total: 3700,
    nextBillingAt: 1800000000000,
    lines: [
      { id: "plan", description: "Store plan", amount: 2900 },
      { id: "cost", description: "Refund costs", amount: 800 },
    ],
  });
  render(<InvoiceEstimate scopeKey="seller" load={load} />);
  expect(load).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "View estimate" }));
  await screen.findByText("$37.00");
  expect(screen.getByText("Refund costs")).toBeTruthy();
});
