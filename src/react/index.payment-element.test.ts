import { afterEach, describe, expect, it, vi } from "vitest";

describe("better-stripe/react PaymentElement exports", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@stripe/react-stripe-js");
    vi.doUnmock("@stripe/react-stripe-js/checkout");
  });

  it("uses checkout PaymentElement as the default export and keeps the Elements variant aliased", async () => {
    const checkoutPaymentElement = Symbol("checkout-payment-element");
    const elementsPaymentElement = Symbol("elements-payment-element");

    vi.doMock("@stripe/react-stripe-js", async () => {
      const actual = await vi.importActual<
        typeof import("@stripe/react-stripe-js")
      >("@stripe/react-stripe-js");

      return {
        ...actual,
        PaymentElement: elementsPaymentElement,
      };
    });

    vi.doMock("@stripe/react-stripe-js/checkout", async () => {
      const actual = await vi.importActual<
        typeof import("@stripe/react-stripe-js/checkout")
      >("@stripe/react-stripe-js/checkout");

      return {
        ...actual,
        PaymentElement: checkoutPaymentElement,
      };
    });

    const reactExports = await import("./index.js");

    expect(reactExports.PaymentElement).toBe(checkoutPaymentElement);
    expect(reactExports.ElementsPaymentElement).toBe(elementsPaymentElement);
  });
});
