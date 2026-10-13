import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("convex/react", () => ({ useAction: () => mocks.create }));
vi.mock("@fantastic.dev/better-stripe/react", () => ({
  EmbeddedCheckout: () => <p>Stripe full checkout</p>,
}));
vi.mock("./custom-checkout", () => ({
  CustomCheckout: () => <p>Custom Elements form</p>,
}));
vi.mock("./stripe-form-checkout", () => ({
  StripeFormCheckout: () => <p>Stripe compact form</p>,
}));
import { SessionCheckout } from "./session-checkout";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({ clientSecret: "cs_test_secret" });
});
it.each([
  ["embedded", "Stripe full checkout"],
  ["custom", "Custom Elements form"],
  ["form", "Stripe compact form"],
] as const)(
  "initializes %s once with canonical price and referral",
  async (mode, content) => {
    render(
      <SessionCheckout
        mode={mode}
        priceId="price_test"
        referralCode="avery"
        publishableKey="pk_test_example"
      />,
    );
    expect(await screen.findByText(content)).toBeVisible();
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        uiMode: mode,
        stripePriceId: "price_test",
        referralCode: "avery",
        returnUrl: expect.stringContaining("{CHECKOUT_SESSION_ID}"),
      }),
    );
  },
);
it("offers a hosted redirect only after the developer explicitly continues", async () => {
  mocks.create.mockResolvedValue({
    url: "https://checkout.stripe.com/example",
  });
  render(
    <SessionCheckout
      mode="redirect"
      priceId="price_test"
      publishableKey="pk_test_example"
    />,
  );
  expect(
    await screen.findByRole("button", { name: "Continue to Stripe Checkout" }),
  ).toBeVisible();
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({
      uiMode: "redirect",
      returnUrl: expect.not.stringContaining("{CHECKOUT_SESSION_ID}"),
    }),
  );
});
it("reports missing client secrets and server errors", async () => {
  mocks.create.mockResolvedValue({});
  const { unmount } = render(
    <SessionCheckout priceId="price_test" publishableKey="pk_test_example" />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "No client secret returned",
  );
  unmount();
  mocks.create.mockRejectedValue(new Error("Seller unavailable"));
  render(
    <SessionCheckout priceId="price_test" publishableKey="pk_test_example" />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Seller unavailable",
  );
});
