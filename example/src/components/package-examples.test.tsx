import { getFunctionName } from "convex/server";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  role: "seller",
  account: "acct_seller",
  rows: undefined as unknown,
  load: vi.fn(),
  mutation: vi.fn().mockResolvedValue(null),
  earnings: {
    gross: 2500,
    net: 2000,
    reversed: 0,
    paidOut: 1000,
    currency: "usd",
    payouts: [],
    isLoading: false,
  },
}));
vi.mock("convex/react", () => ({
  useAction: () => mocks.load,
  useConvex: () => ({ mutation: mocks.mutation }),
  useQuery: (_fn: Parameters<typeof getFunctionName>[0], args: unknown) =>
    args === "skip"
      ? undefined
      : ["affiliateDefaults:get", "sellerAffiliateRates:get"].includes(
            getFunctionName(_fn),
          )
        ? {
            affiliateBasisPoints: null,
            affiliateFixedAmount: null,
            effectiveBasisPoints: 2000,
            effectiveFixedAmount: null,
            source: "plan",
            version: 0,
          }
        : mocks.rows,
}));
vi.mock("@/providers/role-context", () => ({
  useRole: () => ({
    currentRole: mocks.role,
    currentUser: { id: "seller_id", stripeAccountId: mocks.account },
  }),
}));
vi.mock("@/lib/stripe-hooks", () => ({ useEarnings: () => mocks.earnings }));
import {
  ProductComponents,
  SubscriptionComponents,
  PayoutComponents,
  HostedBillingExample,
} from "./package-examples";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = "seller";
  mocks.account = "acct_seller";
  mocks.rows = undefined;
  mocks.load.mockResolvedValue([
    {
      currency: "usd",
      available: 1200,
      pending: 300,
      payoutSchedule: { interval: "weekly", weeklyAnchor: "monday" },
    },
  ]);
});
it("renders loading and empty catalog states", () => {
  const { rerender } = render(<ProductComponents />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading products");
  mocks.rows = [];
  rerender(<ProductComponents />);
  expect(screen.getByText("No products yet.")).toBeVisible();
});
it("uses PriceCard with the seller catalog and exposes the selected Stripe price", async () => {
  mocks.rows = [
    {
      name: "Classic Tee",
      stripeProductId: "prod_tee",
      prices: [
        {
          stripePriceId: "price_tee",
          unitAmount: 2900,
          currency: "usd",
          type: "one_time",
          active: true,
        },
      ],
    },
  ];
  render(<ProductComponents />);
  expect(screen.getByText("$29.00")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Select price" }));
  expect(screen.getByRole("status")).toHaveTextContent("price_tee");
  const control = within(screen.getByTestId("affiliate-rate-price_tee"));
  expect(
    control.getByRole("combobox", { name: "Commission term" }),
  ).toHaveTextContent("Inherited term");
  await userEvent.click(
    control.getByRole("button", { name: "Fixed amount in USD" }),
  );
  await userEvent.type(
    control.getByRole("spinbutton", { name: "Affiliate payout" }),
    "5.25",
  );
  await userEvent.click(control.getByRole("button", { name: /^Save$/ }));
  await waitFor(() =>
    expect(mocks.mutation).toHaveBeenCalledWith(expect.anything(), {
      sellerId: "seller_id",
      stripeProductId: "prod_tee",
      stripePriceId: "price_tee",
      affiliateBasisPoints: null,
      affiliateFixedAmount: 5.25,
      affiliateCommissionTerm: null,
      expectedVersion: 0,
    }),
  );
});
it("displays current subscription state through SubscriptionCard", () => {
  mocks.rows = [
    {
      stripeSubscriptionId: "sub_test",
      status: "active",
      isTrialing: false,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: 1800000000,
    },
  ];
  render(<SubscriptionComponents />);
  expect(screen.getByText("sub_test")).toBeVisible();
  expect(screen.getByText(/active/i)).toBeVisible();
});
it("loads the current seller balance and resets it when the selected seller changes", async () => {
  const { rerender } = render(<PayoutComponents />);
  await waitFor(() =>
    expect(mocks.load).toHaveBeenCalledWith({ stripeAccountId: "acct_seller" }),
  );
  expect(await screen.findByText("$12.00")).toBeVisible();
  mocks.account = "acct_second";
  mocks.load.mockResolvedValue([
    { currency: "usd", available: 5000, pending: 0 },
  ]);
  rerender(<PayoutComponents />);
  await waitFor(() =>
    expect(mocks.load).toHaveBeenCalledWith({ stripeAccountId: "acct_second" }),
  );
  expect(await screen.findByText("$50.00")).toBeVisible();
  expect(screen.queryByText("$12.00")).not.toBeInTheDocument();
});
it("reports balance errors and offers an account setup state", async () => {
  mocks.load.mockRejectedValue(new Error("Stripe unavailable"));
  const { rerender } = render(<PayoutComponents />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Stripe unavailable",
  );
  mocks.account = "";
  rerender(<PayoutComponents />);
  expect(
    screen.getByText("Set up your Stripe account to see payouts."),
  ).toBeVisible();
});
it("recovers from a failed hosted billing portal request", async () => {
  mocks.load.mockRejectedValue(new Error("Portal configuration missing"));
  render(<HostedBillingExample />);
  await userEvent.click(
    screen.getByRole("button", { name: "Open Stripe Billing Portal" }),
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Portal configuration missing",
  );
  expect(
    screen.getByRole("button", { name: "Open Stripe Billing Portal" }),
  ).toBeEnabled();
  expect(mocks.load).toHaveBeenCalledWith(
    expect.objectContaining({ sellerId: "seller_id" }),
  );
});
