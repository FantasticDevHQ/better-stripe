import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { RefundRow } from "@fantastic.dev/better-stripe/react";
const mocks = vi.hoisted(() => ({
  currency: "jpy",
  refunds: [] as RefundRow[] | undefined,
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
    getFunctionName(fn) === "connect/actions:issueRefund"
      ? mocks.refund
      : mocks.reverse,
  useQuery: (
    fn: Parameters<typeof getFunctionName>[0],
    args: { stripePaymentIntentId?: string; sourceChargeId?: string } | "skip",
  ) => {
    const name = getFunctionName(fn);
    if (name === "accounts/queries:getAccountByUserId")
      return { stripeAccountId: "acct_test" };
    if (name === "connect/queries:listRefunds") return mocks.refunds;
    if (name === "connect/queries:getRefundChargeContext")
      return args !== "skip" && args.sourceChargeId === "ch_test"
        ? mocks.chargeContext
        : null;
    if (name === "connect/queries:getPaymentByStripeId")
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
  mocks.refunds = [];
  mocks.chargeContext = null;
  mocks.refund.mockReset().mockResolvedValue({ stripeRefundId: "re_example" });
  mocks.reverse.mockReset().mockResolvedValue({
    reversals: [],
    summary: { reversalCount: 0, totalReversed: 0 },
  });
});

it("labels the bounded preview and separates succeeded refunds from other request amounts", () => {
  mocks.refunds = [
    {
      stripeRefundId: "re_usd",
      amount: 100,
      currency: "usd",
      status: "succeeded",
    },
    {
      stripeRefundId: "re_jpy",
      amount: 500,
      currency: "jpy",
      status: "succeeded",
    },
    {
      stripeRefundId: "re_eur",
      amount: 200,
      currency: "eur",
      status: "pending",
    },
    {
      stripeRefundId: "re_failed",
      amount: 300,
      currency: "jpy",
      status: "failed",
    },
    {
      stripeRefundId: "re_canceled",
      amount: 400,
      currency: "usd",
      status: "canceled",
    },
    {
      stripeRefundId: "re_unknown",
      amount: 100,
      currency: "zzz",
      status: "succeeded",
    },
  ];
  render(<SellerRefunds />);
  expect(screen.getByText(/up to 25 loaded rows/i)).toBeInTheDocument();
  expect(screen.getByTestId("refund-preview-succeeded-usd")).toHaveTextContent(
    "$1.00",
  );
  expect(screen.getByTestId("refund-preview-succeeded-jpy")).toHaveTextContent(
    "¥500",
  );
  expect(screen.getByTestId("refund-preview-pending-eur")).toHaveTextContent(
    "€2.00",
  );
  expect(screen.getByTestId("refund-preview-failed-jpy")).toHaveTextContent(
    "¥300",
  );
  expect(screen.getByTestId("refund-preview-canceled-usd")).toHaveTextContent(
    "$4.00",
  );
  expect(screen.getByTestId("refund-preview-succeeded-zzz")).toHaveTextContent(
    "Amount unavailable",
  );
  expect(screen.queryByTestId("refund-history-total")).not.toBeInTheDocument();
  expect(screen.getByText("Succeeded refunds (USD)")).toBeInTheDocument();
  expect(screen.getByText("Pending requests (EUR)")).toBeInTheDocument();
});

it("does not invent a zero-currency total for an empty refund preview", () => {
  render(<SellerRefunds />);
  expect(screen.getByTestId("refund-history-count")).toHaveTextContent("0");
  expect(screen.queryByTestId("refund-history-total")).not.toBeInTheDocument();
  expect(
    screen.getByText("No refund amounts in this preview"),
  ).toBeInTheDocument();
});

it("keeps a loading preview distinct from an empty history", () => {
  mocks.refunds = undefined;
  render(<SellerRefunds />);
  expect(screen.getByText("Loading refund amounts...")).toBeInTheDocument();
  expect(
    screen.queryByText("No refund amounts in this preview"),
  ).not.toBeInTheDocument();
  expect(screen.getByTestId("refund-history-count")).toHaveTextContent("...");
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
