// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  onConfirm: undefined as undefined | ((event: object) => unknown),
}));
vi.mock("@stripe/stripe-js", () => ({
  loadStripe: () => Promise.resolve(null),
}));
vi.mock("@stripe/react-stripe-js/checkout", () => ({
  CheckoutFormProvider: ({ children }: { children: ReactNode }) => children,
  CheckoutForm: ({ onConfirm }: { onConfirm: (event: object) => unknown }) => {
    mocks.onConfirm = onConfirm;
    return <p>Stripe form</p>;
  },
  useCheckoutForm: () => ({
    type: "success",
    checkout: { id: "cs_form", confirm: mocks.confirm },
  }),
}));
import { CheckoutForm } from "./CheckoutForms.js";
afterEach(cleanup);
it("returns a promise for the Stripe form confirmation lifecycle and uses the actual session ID", async () => {
  mocks.confirm.mockResolvedValue({ type: "success" });
  const navigate = vi.fn();
  render(
    <CheckoutForm
      publishableKey="pk_test_example"
      clientSecret="cs_form_secret"
      returnUrl="https://app.test/receipt?session_id={CHECKOUT_SESSION_ID}"
      onNavigate={navigate}
    />,
  );
  let pending: unknown;
  await act(async () => {
    pending = mocks.onConfirm!({ type: "confirm" });
    await pending;
  });
  expect(pending).toBeInstanceOf(Promise);
  expect(mocks.confirm).toHaveBeenCalledWith({
    formConfirmEvent: { type: "confirm" },
  });
  expect(navigate).toHaveBeenCalledWith(
    "https://app.test/receipt?session_id=cs_form",
  );
});
it("reports Stripe form confirmation failures", async () => {
  mocks.confirm.mockResolvedValue({
    type: "error",
    error: { message: "Card declined" },
  });
  render(
    <CheckoutForm
      publishableKey="pk_test_example"
      clientSecret="cs_form_secret"
      returnUrl="/receipt"
      onNavigate={vi.fn()}
    />,
  );
  await act(async () => {
    await mocks.onConfirm!({ type: "confirm" });
  });
  expect(screen.getByRole("alert").textContent).toContain("Card declined");
});
