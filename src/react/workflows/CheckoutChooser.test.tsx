// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { CheckoutChooser } from "./CheckoutChooser.js";
afterEach(cleanup);
it("offers five checkout types, explains tradeoffs, and reports the selected mode", async () => {
  const change = vi.fn();
  render(<CheckoutChooser onValueChange={change} />);
  expect(screen.getAllByRole("button")).toHaveLength(5);
  expect(
    screen
      .getByRole("button", { name: "Embedded Checkout" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  await userEvent.click(
    screen.getByRole("button", { name: "Hosted Checkout" }),
  );
  expect(change).toHaveBeenCalledWith("redirect");
  expect(screen.getByText(/Redirects away from your app/)).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "Stripe documentation" })
      .getAttribute("href"),
  ).toBe("https://docs.stripe.com/payments/checkout");
});
it("preserves a controlled selection and marks Payment Intents unsupported for recurring products", async () => {
  const change = vi.fn();
  render(
    <CheckoutChooser value="payment-intent" recurring onValueChange={change}>
      {(state) => (
        <>
          <span>{state.selected.id}</span>
          <span>{String(state.unsupported)}</span>
          <button onClick={() => state.select("custom")}>Switch</button>
        </>
      )}
    </CheckoutChooser>,
  );
  expect(screen.getByText("true")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Switch" }));
  expect(change).toHaveBeenCalledWith("custom");
  expect(screen.getByText("payment-intent")).toBeTruthy();
});
