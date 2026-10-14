import { describe, expect, it, vi } from "vitest";

const elements = vi.hoisted(() => ({
  checkout: Symbol("checkout-payment-element"),
  paymentIntent: Symbol("elements-payment-element"),
}));
vi.mock("@stripe/react-stripe-js", async () => ({
  ...(await vi.importActual<typeof import("@stripe/react-stripe-js")>(
    "@stripe/react-stripe-js",
  )),
  PaymentElement: elements.paymentIntent,
}));
vi.mock("@stripe/react-stripe-js/checkout", async () => ({
  ...(await vi.importActual<typeof import("@stripe/react-stripe-js/checkout")>(
    "@stripe/react-stripe-js/checkout",
  )),
  PaymentElement: elements.checkout,
}));
import * as reactExports from "./index.js";

describe("better-stripe/react PaymentElement exports", () => {
  it("uses checkout PaymentElement as the default export and keeps the Elements variant aliased", () => {
    expect(reactExports.PaymentElement).toBe(elements.checkout);
    expect(reactExports.ElementsPaymentElement).toBe(elements.paymentIntent);
  });
});
