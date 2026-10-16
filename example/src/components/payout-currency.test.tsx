import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("@/providers/role-context", () => ({
  useRole: () => ({
    currentUser: { id: "seller", role: "seller", stripeAccountId: "acct_test" },
  }),
}));
vi.mock("@/components/payout-policy-panel", () => ({
  PayoutPolicyPanel: () => null,
}));
vi.mock("@/components/affiliate-recovery-panel", () => ({
  AffiliateRecoveryPanel: () => null,
}));
vi.mock("convex/react", () => ({
  useAction: () => async () => ({
    status: "ready",
    balances: [
      { currency: "jpy", available: 100, pending: 200 },
      { currency: "kwd", available: 1000, pending: 2000 },
      { currency: "usd", available: 1234, pending: 5678 },
      { currency: "isk", available: 123, pending: 234 },
    ],
    payouts: [
      {
        id: "po_jpy",
        currency: "jpy",
        amount: 100,
        status: "paid",
        arrivalDate: null,
      },
      {
        id: "po_kwd",
        currency: "kwd",
        amount: 1000,
        status: "pending",
        arrivalDate: null,
      },
    ],
    upcoming: [
      {
        id: "po_kwd",
        currency: "kwd",
        amount: 1000,
        status: "pending",
        arrivalDate: null,
      },
    ],
    nextCursor: null,
    upcomingComplete: true,
  }),
}));

import { Payouts } from "../pages/seller/payouts";

it("preserves observed currency units in balances, next payout and history", async () => {
  render(<Payouts />);
  expect((await screen.findAllByText("¥100")).length).toBe(2);
  expect(screen.getByText("¥200")).toBeVisible();
  expect(
    screen.getAllByText("KWD 1000 minor units (display unavailable)").length,
  ).toBe(3);
  expect(
    screen.getByText("KWD 2000 minor units (display unavailable)"),
  ).toBeVisible();
  expect(screen.getByText("$12.34")).toBeVisible();
  expect(screen.getByText("$56.78")).toBeVisible();
  expect(screen.getByText("ISK 1.23")).toBeVisible();
  const row = screen.getByText("po_jpy").closest("tr")!;
  expect(within(row).getByText("¥100")).toBeVisible();
});
