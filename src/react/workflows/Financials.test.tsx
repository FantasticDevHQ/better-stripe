// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ChargeSummary, PaymentDetails } from "./Financials.js";
afterEach(cleanup);
it("displays server-authoritative destination-charge amounts and reconciliation status", () => {
  render(
    <ChargeSummary
      gross={10000}
      fee={900}
      net={9100}
      currency="usd"
      reconciles={false}
    />,
  );
  expect(screen.getByText("$91.00")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("does not reconcile");
});
it("shows recorded payment refund state, including a failed refund", () => {
  const { rerender } = render(<PaymentDetails payment={undefined} />);
  expect(screen.getByRole("status")).toBeTruthy();
  rerender(
    <PaymentDetails
      payment={{
        amount: 1000,
        currency: "usd",
        status: "succeeded",
        refundedAmount: 200,
        refundStatus: "failed",
      }}
    />,
  );
  expect(screen.getByText("$2.00")).toBeTruthy();
  expect(screen.getByText("failed")).toBeTruthy();
});
