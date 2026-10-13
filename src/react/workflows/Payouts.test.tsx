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
