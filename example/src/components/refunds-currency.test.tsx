import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  currency: "jpy",
  chargeContext: null as
    { sourceChargeId: string; currency: string } | null | undefined,
  refund: vi.fn(),
  reverse: vi.fn(),
}));
vi.mock("@/providers/role-context", () => ({
  useRole: () => ({ currentUser: { id: "seller_id" } }),
}));
vi.mock("@/components/seller-costs", () => ({ SellerCosts: () => null }));
vi.mock("react-router-dom", () => ({
  useSearchParams: () => [
    new URLSearchParams("payment_intent=pi_test&charge_id=ch_test"),
  ],
}));
vi.mock("convex/react", () => ({
  useAction: (fn: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(fn) === "actions:issueRefund"
      ? mocks.refund
      : mocks.reverse,
  useQuery: (
    fn: Parameters<typeof getFunctionName>[0],
    args: { stripePaymentIntentId?: string; sourceChargeId?: string } | "skip",
  ) => {
    const name = getFunctionName(fn);
    if (name === "queries:getAccountByUserId")
      return { stripeAccountId: "acct_test" };
    if (name === "queries:getRefundChargeContext")
      return args !== "skip" && args.sourceChargeId === "ch_test"
        ? mocks.chargeContext
        : null;
    if (name === "queries:getPaymentByStripeId")
      return args !== "skip" && args.stripePaymentIntentId === "pi_test"
        ? {
            stripePaymentIntentId: "pi_test",
            currency: mocks.currency,
            amount: 50000,
            amountRefunded: 0,
            status: "succeeded",
          }
        : null;
    return [];
  },
}));
import { SellerRefunds } from "../pages/seller/refunds";
beforeEach(() => {
  mocks.chargeContext = null;
  mocks.refund.mockReset().mockResolvedValue({ stripeRefundId: "re_example" });
  mocks.reverse.mockReset().mockResolvedValue({
    reversals: [],
    summary: { reversalCount: 0, totalReversed: 0 },
  });
});
it.each([
  ["jpy", "500", 500],
  ["isk", "500", 50000],
  ["huf", "10.45", 1045],
])(
  "uses the original %s payment currency in the Vite headless workflow",
  async (currency, input, units) => {
    mocks.currency = currency;
    render(<SellerRefunds />);
    await userEvent.type(
      screen.getByTestId("refund-partial-amount-input"),
      input,
    );
    await userEvent.click(screen.getByTestId("refund-partial-button"));
    expect(mocks.refund).toHaveBeenCalledWith({
      stripePaymentIntentId: "pi_test",
      amountCents: units,
      reason: "requested_by_customer",
      userId: "seller_id",
    });
    await userEvent.type(
      screen.getByTestId("reversal-partial-amount-input"),
      input,
    );
    expect(screen.getByTestId("reversal-partial-button")).toBeDisabled();
    expect(mocks.reverse).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByTestId("reversal-charge-input"));
    await userEvent.type(
      screen.getByTestId("reversal-charge-input"),
      "ch_unverified",
    );
    expect(screen.getByTestId("reversal-partial-button")).toBeDisabled();
  },
);

it("uses an independently loaded ISK charge with a JPY refund payment", async () => {
  mocks.currency = "jpy";
  mocks.chargeContext = { sourceChargeId: "ch_test", currency: "isk" };
  render(<SellerRefunds />);
  await userEvent.type(
    screen.getByTestId("reversal-partial-amount-input"),
    "500",
  );
  expect(screen.getByTestId("reversal-partial-button")).toBeEnabled();
  await userEvent.click(screen.getByTestId("reversal-partial-button"));
  expect(mocks.reverse).toHaveBeenCalledWith({
    sourceChargeId: "ch_test",
    amountCents: 50000,
    userId: "seller_id",
  });
  await userEvent.clear(screen.getByTestId("reversal-charge-input"));
  await userEvent.type(
    screen.getByTestId("reversal-charge-input"),
    "ch_unverified",
  );
  expect(screen.getByTestId("reversal-partial-button")).toBeDisabled();
  expect(screen.getByTestId("reversal-partial-amount-input")).toHaveValue("");
});

it.each([
  undefined,
  null,
  { sourceChargeId: "ch_wrong", currency: "isk" },
  { sourceChargeId: "ch_test", currency: "zzz" },
])(
  "disables partial reversal for unavailable or mismatched charge context %j",
  (context) => {
    mocks.chargeContext = context;
    render(<SellerRefunds />);
    expect(screen.getByTestId("reversal-partial-button")).toBeDisabled();
    expect(mocks.reverse).not.toHaveBeenCalled();
  },
);
