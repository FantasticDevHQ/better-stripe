// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { EmbeddedCheckout } from "./EmbeddedCheckout.js";

const { createEmbeddedCheckoutPage, mount, destroy } = vi.hoisted(() => ({
  createEmbeddedCheckoutPage: vi.fn(),
  mount: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock("@stripe/stripe-js", () => ({
  loadStripe: () =>
    Promise.resolve({
      createEmbeddedCheckoutPage,
      // React Stripe.js validates a Stripe instance with these methods.
      elements: vi.fn(),
      createToken: vi.fn(),
      createPaymentMethod: vi.fn(),
      confirmCardPayment: vi.fn(),
    }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("mounts through the current Stripe.js API, forwards completion, and remounts a new session", async () => {
  createEmbeddedCheckoutPage.mockResolvedValue({ mount, destroy });
  const onComplete = vi.fn();
  const view = render(
    <EmbeddedCheckout
      publishableKey="pk_test_local"
      clientSecret="cs_first_secret"
      onComplete={onComplete}
    />,
  );
  await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
  const firstOptions = createEmbeddedCheckoutPage.mock.calls[0][0];
  expect(await firstOptions.fetchClientSecret()).toBe("cs_first_secret");
  firstOptions.onComplete();
  expect(onComplete).toHaveBeenCalledTimes(1);
  view.rerender(
    <EmbeddedCheckout
      publishableKey="pk_test_local"
      clientSecret="cs_second_secret"
      onComplete={onComplete}
    />,
  );
  await waitFor(() => expect(mount).toHaveBeenCalledTimes(2));
  expect(destroy).toHaveBeenCalledTimes(1);
  expect(
    await createEmbeddedCheckoutPage.mock.calls[1][0].fetchClientSecret(),
  ).toBe("cs_second_secret");
  view.unmount();
  expect(destroy).toHaveBeenCalledTimes(2);
});
