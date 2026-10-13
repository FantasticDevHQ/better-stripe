// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import {
  Sales,
  Invoices,
  RefundHistory,
  ReferredSales,
} from "./Collections.js";
afterEach(cleanup);
it("renders sale economics in minor units without recomputing the platform's fee policy", () => {
  render(
    <Sales
      rows={[
        {
          paymentIntentId: "pi_sale",
          planId: "custom",
          gross: 10000,
          processingFee: 320,
          platformNet: 580,
          affiliateNet: 1820,
          costRecoveryAmount: 100,
          sellerNet: 7180,
          currency: "usd",
          status: "settled",
        },
      ]}
    />,
  );
  expect(screen.getByText("$100.00")).toBeTruthy();
  expect(screen.getByText("$71.80")).toBeTruthy();
  expect(screen.getByText("pi_sale")).toBeTruthy();
});
it("renders invoice links and explicit loading/empty states", () => {
  const { rerender } = render(<Invoices rows={undefined} />);
  expect(screen.getByRole("status").textContent).toContain("Loading");
  rerender(<Invoices rows={[]} />);
  expect(screen.getByText("No invoices yet.")).toBeTruthy();
  rerender(
    <Invoices
      rows={[
        {
          stripeInvoiceId: "in_test",
          status: "paid",
          amountPaid: 1200,
          currency: "usd",
          hostedInvoiceUrl: "https://invoice.stripe.com/test",
        },
      ]}
    />,
  );
  expect(
    screen.getByRole("link", { name: "View invoice" }).getAttribute("href"),
  ).toBe("https://invoice.stripe.com/test");
});
it("preserves store attribution in referred sales and refund statuses in history", () => {
  const { unmount } = render(
    <ReferredSales
      rows={[
        {
          stripeTransferId: "tr_test",
          storeName: "Independent Store",
          amount: 900,
          currency: "usd",
        },
      ]}
    />,
  );
  expect(screen.getByText("Independent Store")).toBeTruthy();
  unmount();
  render(
    <RefundHistory
      rows={[
        {
          stripeRefundId: "re_test",
          amount: 1000,
          currency: "usd",
          status: "failed",
          _creationTime: Date.UTC(2026, 9, 13),
        },
      ]}
    />,
  );
  expect(screen.getByText("failed")).toBeTruthy();
  expect(screen.getByRole("columnheader", { name: "Created" })).toBeTruthy();
});
