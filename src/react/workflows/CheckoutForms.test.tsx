// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
const mocks = vi.hoisted(() => ({
  updateEmail: vi.fn(),
  confirm: vi.fn(),
  submit: vi.fn(),
  confirmPayment: vi.fn(),
}));
vi.mock("../components/CheckoutSessionProvider.js", () => ({
  CheckoutSessionProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../components/StripeProvider.js", () => ({
  StripeProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@stripe/react-stripe-js/checkout", () => ({
  PaymentElement: () => <p>Secure payment details</p>,
  useCheckout: () => ({
    type: "success",
    checkout: {
      id: "cs_test",
      canConfirm: false,
      updateEmail: mocks.updateEmail,
      confirm: mocks.confirm,
    },
  }),
}));
vi.mock("@stripe/react-stripe-js", () => ({
  PaymentElement: () => <p>Secure payment details</p>,
  useStripe: () => ({ confirmPayment: mocks.confirmPayment }),
  useElements: () => ({ submit: mocks.submit }),
}));
import { CheckoutElementsForm, PaymentIntentForm } from "./CheckoutForms.js";
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateEmail.mockResolvedValue({ type: "success" });
  mocks.confirm.mockResolvedValue({
    type: "error",
    error: { message: "Card declined" },
  });
  mocks.submit.mockResolvedValue({});
  mocks.confirmPayment.mockResolvedValue({
    error: { message: "Card declined" },
  });
});
const props = {
  publishableKey: "pk_test_example",
  clientSecret: "cs_test_secret",
  returnUrl: "https://app.test/receipt?session_id={CHECKOUT_SESSION_ID}",
  email: "buyer@example.com",
  onNavigate: vi.fn(),
};
it("sends the email before confirming, including when canConfirm is initially false", async () => {
  render(<CheckoutElementsForm {...props} />);
  await userEvent.click(screen.getByRole("button", { name: "Pay" }));
  expect(mocks.updateEmail).toHaveBeenCalledWith("buyer@example.com");
  expect(mocks.confirm).toHaveBeenCalledOnce();
  expect(screen.getByRole("alert").textContent).toContain("Card declined");
});
it("does not confirm after Stripe rejects the email", async () => {
  mocks.updateEmail.mockResolvedValue({
    type: "error",
    error: { message: "Invalid email" },
  });
  render(<CheckoutElementsForm {...props} />);
  await userEvent.click(screen.getByRole("button", { name: "Pay" }));
  expect(screen.getByRole("alert").textContent).toContain("Invalid email");
  expect(mocks.confirm).not.toHaveBeenCalled();
});
it("disables confirmation while Stripe is processing and supports a new attempt after failure", async () => {
  let resolve!: (value: unknown) => void;
  mocks.confirm.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(<CheckoutElementsForm {...props} />);
  await userEvent.click(screen.getByRole("button", { name: "Pay" }));
  expect(
    (screen.getByRole("button", { name: "Processing…" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  resolve({ type: "error", error: { message: "Try another card" } });
  await screen.findByText("Try another card");
  expect(
    (screen.getByRole("button", { name: "Pay" }) as HTMLButtonElement).disabled,
  ).toBe(false);
});
it("validates Elements before confirming a Payment Intent", async () => {
  mocks.submit.mockResolvedValue({ error: { message: "Enter a valid card" } });
  render(<PaymentIntentForm {...props} returnUrl="https://app.test/receipt" />);
  await userEvent.click(screen.getByRole("button", { name: "Pay" }));
  expect(screen.getByRole("alert").textContent).toContain("Enter a valid card");
  expect(mocks.confirmPayment).not.toHaveBeenCalled();
});
it("includes the contact email and redirects to a server-confirmed receipt", async () => {
  mocks.confirmPayment.mockResolvedValue({ paymentIntent: { id: "pi_test" } });
  const navigate = vi.fn();
  render(
    <PaymentIntentForm
      {...props}
      returnUrl="https://app.test/receipt?ref=avery"
      onNavigate={navigate}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Pay" }));
  expect(mocks.confirmPayment).toHaveBeenCalledWith(
    expect.objectContaining({
      confirmParams: expect.objectContaining({
        payment_method_data: {
          billing_details: { email: "buyer@example.com" },
        },
      }),
    }),
  );
  expect(navigate).toHaveBeenCalledWith(
    "https://app.test/receipt?ref=avery&payment_intent=pi_test",
  );
});
