/**
 * Tests for BetterStripe error utilities — throwStripeError and isBetterStripeError.
 */
import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";

import { isBetterStripeError, throwStripeError } from "./errors";

describe("throwStripeError", () => {
  it("throws ConvexError with code and message", () => {
    expect(() =>
      throwStripeError("ACCOUNT_NOT_FOUND", "Account does not exist"),
    ).toThrowError(ConvexError);

    try {
      throwStripeError("ACCOUNT_NOT_FOUND", "Account does not exist");
      expect.unreachable("should have thrown");
    } catch (error) {
      const data = (error as ConvexError<{ code: string; message: string }>)
        .data;
      expect(data.code).toBe("ACCOUNT_NOT_FOUND");
      expect(data.message).toBe("Account does not exist");
    }
  });

  it("includes stripeError when provided", () => {
    let caught: unknown;
    try {
      throwStripeError("STRIPE_API_ERROR", "Stripe call failed", {
        type: "card_error",
        code: "card_declined",
        message: "Your card was declined.",
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      caught = error;
    }
    const data = (
      caught as ConvexError<{
        stripeError: { type: string; code: string; message: string };
      }>
    ).data;
    expect(data.stripeError).toEqual({
      type: "card_error",
      code: "card_declined",
      message: "Your card was declined.",
    });
  });
});

describe("isBetterStripeError", () => {
  it("returns true for BetterStripe errors", () => {
    let caught: unknown;
    try {
      throwStripeError("PRODUCT_NOT_FOUND", "Missing product");
      expect.unreachable("should have thrown");
    } catch (error) {
      caught = error;
    }
    expect(isBetterStripeError(caught)).toBe(true);
  });

  it("returns false for regular errors", () => {
    expect(isBetterStripeError(new Error("plain error"))).toBe(false);
  });
});
