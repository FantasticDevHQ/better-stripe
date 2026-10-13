// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { PaymentReceipt } from "./PaymentReceipt.js";
afterEach(cleanup);
it("shows success only after the application supplies a confirmed server payment", () => {
  const { rerender } = render(<PaymentReceipt payment={undefined} />);
  expect(screen.getByRole("status").textContent).toContain(
    "Waiting for Stripe",
  );
  rerender(
    <PaymentReceipt
      payment={{ status: "processing", amount: 2900, currency: "usd" }}
    />,
  );
  expect(screen.queryByText("Payment successful!")).toBeNull();
  rerender(
    <PaymentReceipt
      payment={{ status: "succeeded", amount: 2900, currency: "usd" }}
    />,
  );
  expect(screen.getByText("Payment successful!")).toBeTruthy();
  expect(screen.getByText("$29.00")).toBeTruthy();
});
