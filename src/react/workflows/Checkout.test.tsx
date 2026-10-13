// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("../components/EmbeddedCheckout.js", () => ({
  EmbeddedCheckout: () => <div>Stripe iframe</div>,
}));
vi.mock("./CheckoutForms.js", () => ({
  CheckoutElementsForm: () => <div>Elements form</div>,
  PaymentIntentForm: () => <div>Intent form</div>,
  CheckoutForm: () => <div>Compact form</div>,
}));
import { Checkout } from "./Checkout.js";
afterEach(cleanup);
it("opens hosted Checkout only on explicit interaction", async () => {
  const createSession = vi.fn().mockResolvedValue({
    stripeSessionId: "cs_test",
    url: "https://checkout.stripe.com/test",
  });
  const navigate = vi.fn();
  render(
    <Checkout
      mode="redirect"
      orderKey="order_one"
      publishableKey="pk_test_example"
      returnUrl="https://app.test/receipt"
      createSession={createSession}
      onNavigate={navigate}
    />,
  );
  await screen.findByRole("button", { name: "Continue to Stripe Checkout" });
  expect(navigate).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Continue to Stripe Checkout" }),
  );
  expect(navigate).toHaveBeenCalledWith("https://checkout.stripe.com/test");
  expect(createSession).toHaveBeenCalledWith(
    expect.objectContaining({
      mode: "redirect",
      requestId: expect.any(String),
    }),
  );
});
it.each([
  ["embedded", "Stripe iframe"],
  ["custom", "Elements form"],
  ["form", "Compact form"],
] as const)("dispatches %s to the correct integration", async (mode, title) => {
  render(
    <Checkout
      mode={mode}
      orderKey="order_one"
      publishableKey="pk_test_example"
      returnUrl="https://app.test/receipt"
      createSession={async () => ({
        stripeSessionId: "cs_test",
        clientSecret: "cs_test_secret",
      })}
    />,
  );
  expect(await screen.findByText(title)).toBeTruthy();
});
it("exposes creation errors and retries without losing the selected integration", async () => {
  const createSession = vi
    .fn()
    .mockRejectedValueOnce(new Error("Seller plan expired"))
    .mockResolvedValueOnce({
      stripeSessionId: "cs_test",
      clientSecret: "cs_test_secret",
    });
  render(
    <Checkout
      mode="embedded"
      orderKey="order_one"
      publishableKey="pk_test_example"
      returnUrl="https://app.test/receipt"
      createSession={createSession}
    />,
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Seller plan expired",
  );
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("Stripe iframe");
  await waitFor(() => expect(createSession).toHaveBeenCalledTimes(2));
});
it("rejects missing session secrets and initializes Payment Intents through their own callback", async () => {
  const { unmount } = render(
    <Checkout
      mode="embedded"
      orderKey="order_one"
      publishableKey="pk_test_example"
      returnUrl="https://app.test/receipt"
      createSession={async () => ({ stripeSessionId: "cs_test" })}
    />,
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "client secret",
  );
  unmount();
  const createPaymentIntent = vi.fn().mockResolvedValue({
    paymentIntentId: "pi_test",
    clientSecret: "pi_test_secret",
  });
  render(
    <Checkout
      mode="payment-intent"
      orderKey="order_one"
      publishableKey="pk_test_example"
      returnUrl="https://app.test/receipt"
      createPaymentIntent={createPaymentIntent}
    />,
  );
  await screen.findByText("Intent form");
  expect(createPaymentIntent).toHaveBeenCalledWith({
    requestId: expect.any(String),
  });
});
