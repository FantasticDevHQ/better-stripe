// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { Payouts } from "./Payouts.js";
afterEach(cleanup);
const row = (id: string, status = "paid") => ({
  id,
  status,
  amount: 5000,
  currency: "usd",
  arrivalDate: 1800000000000,
  created: 1799990000000,
});
it("shows balances, the actual next payout/date, and merges paginated history without duplicates", async () => {
  const first = row("po_first");
  const next = row("po_next", "pending");
  const load = vi
    .fn()
    .mockResolvedValueOnce({
      balances: [{ currency: "usd", available: 12000, pending: 2000 }],
      upcoming: [next],
      payouts: [next, first],
      nextCursor: "po_first",
    })
    .mockResolvedValueOnce({
      balances: [],
      upcoming: [next],
      payouts: [first, row("po_older")],
      nextCursor: null,
    });
  render(<Payouts scopeKey="acct_one" load={load} />);
  await screen.findByText("$120.00");
  expect(screen.getByText("$20.00")).toBeTruthy();
  expect(screen.getByText("po_next")).toBeTruthy();
  await userEvent.click(
    screen.getByRole("button", { name: "Load more payouts" }),
  );
  await screen.findByText("po_older");
  expect(screen.getAllByText("po_first")).toHaveLength(1);
  expect(screen.getByText("$120.00")).toBeTruthy();
  expect(load).toHaveBeenLastCalledWith("po_first");
});
it("shows a load error with a working retry", async () => {
  const load = vi
    .fn()
    .mockRejectedValueOnce(new Error("No balance access"))
    .mockResolvedValueOnce({
      balances: [],
      upcoming: [],
      payouts: [],
      nextCursor: null,
    });
  render(<Payouts scopeKey="acct_one" load={load} />);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "No balance access",
  );
  await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await screen.findByText("No previous payouts yet.");
});
it("exports payout history with explicit empty/loading states and date formatting", async () => {
  const { PayoutHistory } = await import("./Payouts.js");
  const { rerender } = render(<PayoutHistory rows={undefined} />);
  expect(screen.getByRole("status")).toBeTruthy();
  rerender(<PayoutHistory rows={[]} />);
  expect(screen.getByText("No payouts yet.")).toBeTruthy();
  rerender(
    <PayoutHistory
      rows={[
        {
          id: "po_history",
          amount: 900,
          currency: "usd",
          status: "paid",
          arrivalDate: null,
        },
      ]}
    />,
  );
  expect(screen.getByText("po_history")).toBeTruthy();
  expect(screen.getByText("Not supplied by Stripe")).toBeTruthy();
});
it("keeps completed payouts out of upcoming and sorts the remaining arrivals", async () => {
  const pending = {
    ...row("po_pending", "pending"),
    arrivalDate: 1900000000000,
  };
  const transit = {
    ...row("po_transit", "in_transit"),
    arrivalDate: 1800000000000,
  };
  const paid = row("po_paid");
  const failed = row("po_failed", "failed");
  const load = async () => ({
    balances: [],
    upcoming: [paid, pending, failed, transit],
    payouts: [paid, pending, failed, transit],
    nextCursor: null,
  });
  const { container } = render(<Payouts scopeKey="seller" load={load} />);
  await screen.findByText("po_pending");
  const headings = Array.from(container.querySelectorAll("h3"));
  const upcomingTable = headings.find(
    (node) => node.textContent === "Upcoming payouts",
  )!.nextElementSibling!;
  expect(upcomingTable.textContent).not.toContain("po_paid");
  expect(upcomingTable.textContent).not.toContain("po_failed");
  expect(upcomingTable.textContent!.indexOf("po_transit")).toBeLessThan(
    upcomingTable.textContent!.indexOf("po_pending"),
  );
  expect(screen.getAllByText("po_paid")).toHaveLength(1);
});
it("distinguishes an unavailable account from an empty balance and labels upcoming previews", async () => {
  const load = vi.fn().mockResolvedValue({
    status: "not_ready",
    reason: "account_unavailable",
    balances: [],
    upcoming: [],
    payouts: [],
    nextCursor: null,
    upcomingComplete: true,
  });
  const { unmount } = render(<Payouts scopeKey="unavailable" load={load} />);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "not available",
  );
  expect(screen.queryByText("Not scheduled")).toBeNull();
  unmount();
  render(
    <Payouts
      scopeKey="preview"
      load={async () => ({
        status: "ready",
        balances: [],
        upcoming: [],
        payouts: [],
        nextCursor: null,
        upcomingComplete: false,
      })}
    />,
  );
  expect(
    await screen.findByText(/Upcoming payouts are a bounded preview/),
  ).toBeTruthy();
});
