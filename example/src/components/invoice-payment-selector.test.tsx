import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { InvoicePaymentSelector } from "./invoice-payment-selector";

vi.mock("@stripe/stripe-js", () => ({ loadStripe: vi.fn() }));
afterEach(cleanup);
const paid = {
  id: "inpay_paid",
  paymentIntentId: "pi_paid",
  referenceStatus: "payment_intent" as const,
  amountPaid: 1234,
  currency: "jpy",
  status: "paid",
};
function show(
  props: Partial<React.ComponentProps<typeof InvoicePaymentSelector>> = {},
) {
  const onSelect = vi.fn();
  render(
    <InvoicePaymentSelector
      rows={[paid]}
      isLoading={false}
      hasMore={false}
      error={false}
      onLoadMore={vi.fn()}
      onSelect={onSelect}
      {...props}
    />,
  );
  return onSelect;
}
it("selects a provider-bound payment reference without refunding it", () => {
  const selected = show();
  expect(screen.getByText(/1,234/)).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Review payment pi_paid" }),
  );
  expect(selected).toHaveBeenCalledExactlyOnceWith("pi_paid");
  expect(screen.queryByText("Issue refund")).not.toBeInTheDocument();
});
it("keeps unsupported and unavailable payment rows visible without allowing selection", () => {
  show({
    rows: [
      { ...paid, referenceStatus: "unsupported", paymentIntentId: null },
      {
        ...paid,
        id: "inpay_missing",
        referenceStatus: "unavailable",
        paymentIntentId: null,
      },
    ],
  });
  expect(screen.getByText("Unsupported payment type")).toBeInTheDocument();
  expect(screen.getByText("Payment reference unavailable")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Review payment/ }),
  ).not.toBeInTheDocument();
});
it("preserves pagination after an empty page and disables it while loading", () => {
  const loadMore = vi.fn();
  show({ rows: [], hasMore: true, onLoadMore: loadMore });
  fireEvent.click(
    screen.getByRole("button", { name: "Load more invoice payments" }),
  );
  expect(loadMore).toHaveBeenCalledOnce();
  cleanup();
  show({ rows: [], hasMore: true, isLoading: true });
  expect(
    screen.getByRole("button", { name: "Load more invoice payments" }),
  ).toBeDisabled();
});
it("shows provider failure without presenting an empty completed list", () => {
  show({ rows: [], error: true });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Failed to read invoice payments",
  );
  expect(screen.queryByText("No invoice payments")).not.toBeInTheDocument();
});
