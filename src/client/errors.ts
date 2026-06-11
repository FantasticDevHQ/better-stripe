import { ConvexError } from "convex/values";

export type BetterStripeErrorCode =
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_CREATE_FAILED"
  | "PRODUCT_NOT_FOUND"
  | "PRICE_NOT_FOUND"
  | "SUBSCRIPTION_NOT_FOUND"
  | "CHECKOUT_CREATE_FAILED"
  | "CHECKOUT_NOT_FOUND"
  | "PAYMENT_METHOD_FAILED"
  | "WEBHOOK_VERIFICATION_FAILED"
  | "WEBHOOK_DUPLICATE_EVENT"
  | "STRIPE_API_ERROR"
  | "TEST_ENV_REQUIRED"
  | "INVALID_CONFIGURATION";

export interface BetterStripeError {
  code: BetterStripeErrorCode;
  message: string;
  stripeError?: {
    type: string;
    code?: string;
    message: string;
  };
}

/**
 * Throw a structured ConvexError with a BetterStripe error code.
 * These serialize correctly across Convex action/mutation boundaries.
 */
export function throwStripeError(
  code: BetterStripeErrorCode,
  message: string,
  stripeError?: unknown,
): never {
  const errorData: BetterStripeError = { code, message };

  if (stripeError && typeof stripeError === "object" && "type" in stripeError) {
    const se = stripeError as { type: string; code?: string; message: string };
    errorData.stripeError = {
      type: se.type,
      code: se.code,
      message: se.message,
    };
  }

  throw new ConvexError(errorData as unknown as string);
}

/**
 * Type guard to check if a caught error is a BetterStripeError.
 */
export function isBetterStripeError(error: unknown): boolean {
  return (
    error instanceof ConvexError &&
    typeof error.data === "object" &&
    error.data !== null &&
    "code" in error.data &&
    "message" in error.data
  );
}
