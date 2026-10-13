// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { CostRecovery, ChargebackLedger } from "./Costs.js";
afterEach(cleanup);
it("displays the authoritative cost balances without inventing a recovery policy", () => {
  render(
    <CostRecovery
      rows={[
        {
          paymentIntentId: "pi_cost",
          amountDue: 1000,
          collectedAmount: 400,
          invoicedAmount: 300,
          outstanding: 300,
          currency: "usd",
        },
      ]}
    />,
  );
  expect(screen.getByText("$10.00")).toBeTruthy();
  expect(screen.getByText("$4.00")).toBeTruthy();
  expect(screen.getAllByText("$3.00")).toHaveLength(2);
});
it("renders chargeback economics and explicitly handles missing charge links", () => {
  const { rerender } = render(<ChargebackLedger chargeback={null} />);
  expect(screen.getByText(/No linked charge/)).toBeTruthy();
  rerender(
    <ChargebackLedger
      chargeback={{
        dispute: { stripeChargeId: "ch_one", currency: "usd", status: "lost" },
        gross: 10000,
        reversed: 2000,
        net: 8000,
        transfers: [],
      }}
    />,
  );
  expect(screen.getByText("$80.00")).toBeTruthy();
  expect(screen.getByText("No transfer rows found.")).toBeTruthy();
});
