import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  updateEmail: vi.fn(),
  confirm: vi.fn(),
  submit: vi.fn(),
  confirmPayment: vi.fn(),
  checkout: { type: "success", canConfirm: true, sessionId: "cs_test" },
  payment: undefined as unknown,
}));
vi.mock("convex/react", () => ({
  useAction: () => mocks.create,
  useQuery: () => mocks.payment,
}));
vi.mock("@/providers/role-context", () => ({
  useRole: () => ({ currentUser: { id: "", email: "buyer@example.com" } }),
}));
vi.mock("@fantastic.dev/better-stripe/react", () => ({
  CheckoutSessionProvider: ({ children }: { children: ReactNode }) => children,
  StripeProvider: ({ children }: { children: ReactNode }) => children,
  PaymentElement: () => <p>Secure payment details</p>,
  useCheckoutSession: () => ({ ...mocks.checkout, confirm: mocks.confirm }),
}));
vi.mock("@stripe/react-stripe-js/checkout", () => ({
  useCheckout: () => ({
    type: "success",
    checkout: { updateEmail: mocks.updateEmail },
  }),
}));
vi.mock("@stripe/react-stripe-js", () => ({
  PaymentElement: () => <p>Secure payment details</p>,
  useStripe: () => ({ confirmPayment: mocks.confirmPayment }),
  useElements: () => ({ submit: mocks.submit }),
}));
import { CustomCheckout } from "./custom-checkout";
import { PaymentIntentCheckout } from "./payment-intent-checkout";
import { PaymentIntentReceipt } from "./payment-intent-receipt";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkout = { type: "success", canConfirm: true, sessionId: "cs_test" };
  mocks.create.mockResolvedValue({ clientSecret: "pi_test_secret_example" });
  mocks.updateEmail.mockResolvedValue({ type: "success" });
  mocks.confirm.mockResolvedValue({
    type: "error",
    message: "Your card was declined.",
  });
  mocks.submit.mockResolvedValue({});
  mocks.confirmPayment.mockResolvedValue({
    error: { message: "Card declined" },
  });
});
it("updates the customer's email and reports a declined custom Checkout payment", async () => {
  render(
    <CustomCheckout
      publishableKey="pk_test_example"
      clientSecret="cs_test_secret"
      returnUrl="/checkout/status?session_id={CHECKOUT_SESSION_ID}"
    />,
  );
  const email = screen.getByLabelText("Email for your receipt");
  await userEvent.clear(email);
  await userEvent.type(email, "guest@example.com");
  await userEvent.click(screen.getByRole("button", { name: /^Pay$/ }));
  expect(mocks.updateEmail).toHaveBeenCalledWith("guest@example.com");
  expect(mocks.confirm).toHaveBeenCalledOnce();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Your card was declined.",
  );
  expect(screen.getByRole("button", { name: "Pay" })).toBeEnabled();
});
it("does not confirm payment if Stripe rejects the receipt email", async () => {
  mocks.updateEmail.mockResolvedValue({
    type: "error",
    error: { message: "Invalid email" },
  });
  render(
    <CustomCheckout
      publishableKey="pk_test_example"
      clientSecret="cs_test_secret"
      returnUrl="/"
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Pay" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Invalid email");
  expect(mocks.confirm).not.toHaveBeenCalled();
});
it("disables duplicate submission while custom payment confirmation is pending", async () => {
  let resolve!: (value: unknown) => void;
  mocks.confirm.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(
    <CustomCheckout
      publishableKey="pk_test_example"
      clientSecret="cs_test_secret"
      returnUrl="/"
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Pay" }));
  expect(screen.getByRole("button", { name: "Processing…" })).toBeDisabled();
  resolve({ type: "error", message: "Try another card" });
  await screen.findByText("Try another card");
});
it("creates a guest Payment Intent with referral attribution and validates Elements before confirmation", async () => {
  render(
    <PaymentIntentCheckout
      priceId="price_example"
      referralCode="avery"
      publishableKey="pk_test_example"
    />,
  );
  await screen.findByLabelText("Email");
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({
      stripePriceId: "price_example",
      referralCode: "avery",
      userId: undefined,
      requestId: expect.any(String),
    }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Pay" }));
  expect(mocks.submit).toHaveBeenCalledOnce();
  expect(mocks.confirmPayment).toHaveBeenCalledWith(
    expect.objectContaining({
      redirect: "if_required",
      confirmParams: expect.objectContaining({
        payment_method_data: {
          billing_details: { email: "buyer@example.com" },
        },
      }),
    }),
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Card declined");
});
it("stops a Payment Intent confirmation when payment details fail validation", async () => {
  mocks.submit.mockResolvedValue({
    error: { message: "Enter a valid card number" },
  });
  render(
    <PaymentIntentCheckout
      priceId="price_example"
      publishableKey="pk_test_example"
    />,
  );
  await screen.findByLabelText("Email");
  await userEvent.click(screen.getByRole("button", { name: "Pay" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Enter a valid card number",
  );
  expect(mocks.confirmPayment).not.toHaveBeenCalled();
});
it("reports server payment creation errors without rendering a payment form", async () => {
  mocks.create.mockRejectedValue(new Error("Seller plan expired"));
  render(
    <PaymentIntentCheckout
      priceId="price_example"
      publishableKey="pk_test_example"
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Seller plan expired",
  );
  expect(screen.queryByRole("button", { name: "Pay" })).not.toBeInTheDocument();
});
it("shows success only after the server ledger confirms the Payment Intent", async () => {
  mocks.payment = undefined;
  const ui = (
    <MemoryRouter>
      <PaymentIntentReceipt paymentIntentId="pi_example" />
    </MemoryRouter>
  );
  const { rerender } = render(ui);
  expect(screen.getByRole("status")).toHaveTextContent("Waiting for Stripe");
  mocks.payment = { status: "succeeded", amount: 2500, currency: "usd" };
  rerender(
    <MemoryRouter>
      <PaymentIntentReceipt paymentIntentId="pi_example" />
    </MemoryRouter>,
  );
  await waitFor(() =>
    expect(screen.getByText("Payment successful!")).toBeVisible(),
  );
  expect(screen.getByText("$25.00")).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Continue shopping" }),
  ).toHaveAttribute("href", "/stores");
});

it("allows email validation before confirmation even when Stripe has not yet received that email", async () => {
  mocks.checkout.canConfirm = false;
  render(
    <CustomCheckout
      publishableKey="pk_test_example"
      clientSecret="cs_test_secret"
      returnUrl="/"
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Pay" }));
  expect(mocks.updateEmail).toHaveBeenCalledWith("buyer@example.com");
  expect(mocks.confirm).toHaveBeenCalledOnce();
});
