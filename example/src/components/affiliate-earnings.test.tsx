import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  account: "acct_affiliate",
  earnings: {
    gross: 12345,
    reversed: 100,
    net: 12245,
    paidOut: 0,
    payouts: [],
    currency: "usd",
    isLoading: false,
  },
}));
vi.mock("@/providers/role-context", () => ({
  useRole: () => ({
    currentUser: { name: "Avery Affiliate", stripeAccountId: mocks.account },
  }),
}));
vi.mock("@/lib/stripe-hooks", () => ({ useEarnings: () => mocks.earnings }));
import { Affiliate } from "@/pages/affiliate";

beforeEach(() => {
  mocks.account = "acct_affiliate";
  Object.assign(mocks.earnings, {
    gross: 12345,
    reversed: 100,
    net: 12245,
    isLoading: false,
  });
});
for (const integration of ["headless", "components"] as const) {
  it(`${integration} shows all four metrics and the affiliate account`, () => {
    render(<Affiliate integration={integration} />);
    expect(
      screen.getByRole("heading", { name: "Referral earnings" }),
    ).toBeVisible();
    expect(
      screen.getAllByRole("status").map((node) => node.textContent),
    ).toEqual(["$123.45", "$1.00", "$122.45", "$0.00"]);
    expect(screen.getByText("No payouts yet")).toBeVisible();
    expect(screen.getByText("Stripe account: acct_affiliate")).toBeVisible();
  });
  it(`${integration} keeps cards visible for loading and zero earnings`, () => {
    mocks.earnings.isLoading = true;
    const { rerender } = render(<Affiliate integration={integration} />);
    expect(
      screen.getAllByRole("status").map((node) => node.textContent),
    ).toEqual(["…", "…", "…", "…"]);
    Object.assign(mocks.earnings, {
      gross: 0,
      reversed: 0,
      net: 0,
      isLoading: false,
    });
    rerender(<Affiliate integration={integration} />);
    expect(
      screen.getAllByRole("status").map((node) => node.textContent),
    ).toEqual(["$0.00", "$0.00", "$0.00", "$0.00"]);
  });
  it(`${integration} explains missing affiliate setup`, () => {
    mocks.account = "";
    render(<Affiliate integration={integration} />);
    expect(
      screen.getByText(/Your affiliate Stripe account has not been set up/),
    ).toBeVisible();
    expect(screen.queryByText("Gross")).not.toBeInTheDocument();
  });
}
