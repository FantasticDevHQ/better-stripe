import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MeteredBillingOutcome } from "./metered-billing-outcome";
afterEach(cleanup);
it("keeps unavailable cash separate from paid invoice totals", () => {
  render(
    <MeteredBillingOutcome
      prepaid={false}
      json={JSON.stringify({
        status: "paid",
        invoiceId: "in_original",
        amountPaid: 1500,
        currency: "usd",
        revenue: [{ cash: { status: "unknown" }, routing: "seller" }],
      })}
    />,
  );
  expect(screen.getByText(/Invoice cash paid:/).textContent).toContain("15.00");
  expect(screen.getByText(/Original cash verification: unknown/)).toBeTruthy();
  expect(screen.queryByText(/Actual processing fee:/)).toBeNull();
  expect(screen.getByText(/Settlement has not been verified/)).toBeTruthy();
});
it("shows the original prepaid capture and actual fees independently from zero consumption cash", () => {
  render(
    <MeteredBillingOutcome
      prepaid
      json={JSON.stringify({
        status: "paid",
        amountPaid: 0,
        currency: "usd",
        revenue: [
          {
            cash: {
              status: "ready",
              value: { gross: 1000, processingFee: 59, currency: "usd" },
            },
            settlement: { status: "settled", executedTransfers: [] },
          },
        ],
        renewal: { period: { start: 100, end: 200 }, allowance: null },
      })}
    />,
  );
  expect(screen.getByText(/Captured:/).textContent).toContain("10.00");
  expect(screen.getByText(/Actual processing fee:/).textContent).toContain(
    "0.59",
  );
  expect(screen.getByText(/without a second payment/)).toBeTruthy();
  expect(screen.getByText(/Settlement: settled/)).toBeTruthy();
  expect(screen.getByText(/read-only until event times/)).toBeTruthy();
});
