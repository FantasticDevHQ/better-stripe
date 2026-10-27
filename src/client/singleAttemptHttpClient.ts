import Stripe from "stripe";

/** A transport failure with an unknown remote outcome, never a retry signal. */
class SingleAttemptConnectionClosed extends Error {
  constructor(
    readonly transportCode: string,
    readonly cause: unknown,
  ) {
    super(
      "The connection closed with an unknown outcome. Automatic replay was prevented; retain the original request identity.",
    );
  }
}

/** Guard for Stripe's closed-connection retry exception. */
export class SingleAttemptHttpClient implements Stripe.HttpClient {
  constructor(private readonly delegate: Stripe.HttpClient) {}

  getClientName(): string {
    return `single-attempt:${this.delegate.getClientName()}`;
  }

  async makeRequest(
    ...args: Parameters<Stripe.HttpClient["makeRequest"]>
  ): ReturnType<Stripe.HttpClient["makeRequest"]> {
    try {
      return await this.delegate.makeRequest(...args);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string" &&
        Stripe.HttpClient.CONNECTION_CLOSED_ERROR_CODES.includes(error.code)
      )
        // Stripe retries these codes once even with maxNetworkRetries=0.
        // Keep the original as cause, without exposing .code to its retry loop.
        throw new SingleAttemptConnectionClosed(error.code, error);
      throw error;
    }
  }
}

/** Recover the safe error code only after Stripe's request loop has finished. */
export function singleAttemptPortalError(error: unknown): unknown {
  if (
    typeof error === "object" &&
    error !== null &&
    "detail" in error &&
    error.detail instanceof SingleAttemptConnectionClosed
  )
    return {
      type: "StripeConnectionError",
      code: error.detail.transportCode,
      message: error.detail.message,
    };
  return error;
}
