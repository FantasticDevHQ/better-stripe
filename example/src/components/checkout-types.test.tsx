import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  price: {
    name: "Test product",
    amount: 2500,
    currency: "usd",
    type: "one_time",
  },
}));
vi.mock("convex/react", () => ({ useQuery: () => mocks.price }));
vi.mock("@/providers/role-context", () => ({
  useRole: () => ({ currentUser: { id: "", email: "", role: "visitor" } }),
}));
vi.mock("./session-checkout", () => ({
  SessionCheckout: ({ mode }: { mode: string }) => <p>Session: {mode}</p>,
}));
vi.mock("./payment-intent-checkout", () => ({
  PaymentIntentCheckout: () => <p>Payment Intent form</p>,
}));
import { CheckoutTypeExamples } from "./checkout-types";
function Location() {
  return <output data-testid="location">{useLocation().search}</output>;
}
beforeEach(() => {
  mocks.price.type = "one_time";
  mocks.price.currency = "usd";
  mocks.price.amount = 2500;
});
it("compares all five checkout types and preserves referral attribution when switching", async () => {
  render(
    <MemoryRouter initialEntries={["/checkout?priceId=price_test&ref=avery"]}>
      <CheckoutTypeExamples
        priceId="price_test"
        referralCode="avery"
        publishableKey="pk_test_example"
      />
      <Location />
    </MemoryRouter>,
  );
  expect(screen.getByText("Session: embedded")).toBeVisible();
  expect(screen.getByText("Pros")).toBeVisible();
  expect(screen.getByText("Cons")).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", {
      name: "Choose Payment Element + Payment Intents",
    }),
  );
  expect(screen.getByText("Payment Intent form")).toBeVisible();
  expect(screen.getByTestId("location")).toHaveTextContent(
    "priceId=price_test&ref=avery&checkout=payment-intent",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Choose Hosted Checkout" }),
  );
  expect(screen.getByText("Session: redirect")).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "Choose Embedded Checkout Form" }),
  );
  expect(screen.getByText("Session: form")).toBeVisible();
  expect(screen.getByText("Preview", { exact: true })).toBeVisible();
});
it("does not create a bare Payment Intent for a recurring price", () => {
  mocks.price.type = "recurring";
  render(
    <MemoryRouter initialEntries={["/checkout?checkout=payment-intent"]}>
      <CheckoutTypeExamples
        priceId="price_recurring"
        publishableKey="pk_test_example"
      />
    </MemoryRouter>,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Payment Intents alone do not create subscriptions",
  );
  expect(screen.queryByText("Payment Intent form")).not.toBeInTheDocument();
});

it("shows zero-decimal checkout prices in their original Stripe units", () => {
  mocks.price.currency = "jpy";
  mocks.price.amount = 2500;
  render(
    <MemoryRouter>
      <CheckoutTypeExamples
        priceId="price_jpy"
        publishableKey="pk_test_example"
      />
    </MemoryRouter>,
  );
  expect(screen.getByText(/Test product · ¥2,500/)).toBeVisible();
});
