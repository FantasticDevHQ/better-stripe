// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Overview, getPayoutTotals } from "./Overview.js";
afterEach(cleanup);
it("does not claim live totals until both datasets have loaded", () => {
  const { rerender } = render(
    <Overview products={undefined} subscriptions={[]} />,
  );
  expect(screen.getAllByText("Loading…").length).toBeGreaterThan(0);
  rerender(
    <Overview
      products={[{}]}
      subscriptions={[{ status: "active" }, { status: "canceled" }]}
    />,
  );
  expect(screen.getByText("Total Subscriptions")).toBeTruthy();
  expect(screen.getByText("2")).toBeTruthy();
});
it("does not combine payouts in different currencies", () => {
  const result = getPayoutTotals(
    [
      { amount: 100, status: "paid", currency: "usd" },
      { amount: 900, status: "paid", currency: "eur" },
      { amount: 200, status: "in_transit", currency: "usd" },
    ],
    "usd",
  );
  expect(result.totalPayouts).toBe(100);
  expect(result.pendingBalance).toBe(200);
  expect(result.totalEarned).toBe(300);
});
it("renders payout activity separately from Stripe account balances", async () => {
  const { PayoutOverview } = await import("./Overview.js");
  render(
    <PayoutOverview
      currency="usd"
      payouts={[
        {
          stripePayoutId: "po_one",
          amount: 1000,
          status: "paid",
          currency: "usd",
        },
        {
          stripePayoutId: "po_two",
          amount: 200,
          status: "pending",
          currency: "usd",
        },
      ]}
    />,
  );
  expect(screen.getByText("Upcoming payouts")).toBeTruthy();
  expect(screen.getByText("$2.00")).toBeTruthy();
  expect(screen.queryByText("Pending Balance")).toBeNull();
});
