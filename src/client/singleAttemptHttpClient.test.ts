import Stripe from "stripe";
import { expect, it, vi } from "vitest";
import {
  SingleAttemptHttpClient,
  singleAttemptPortalError,
} from "./singleAttemptHttpClient.js";

const args: Parameters<Stripe.HttpClient["makeRequest"]> = [
  "api.stripe.test",
  "443",
  "/v1/billing_portal/sessions",
  "POST",
  { "Idempotency-Key": "portal:retained", "Stripe-Account": "acct_original" },
  "customer_account=acct_customer",
  "https",
  1000,
];

it.each(Stripe.HttpClient.CONNECTION_CLOSED_ERROR_CODES)(
  "preserves %s as the cause without giving Stripe a retry signal",
  async (code) => {
    const original = Object.assign(new Error("controlled failure"), { code });
    const makeRequest = vi.fn().mockRejectedValue(original);
    const adapter = new SingleAttemptHttpClient({
      getClientName: () => "controlled",
      makeRequest,
    });
    const failure = await adapter
      .makeRequest(...args)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({ cause: original, transportCode: code });
    expect(failure).not.toHaveProperty("code");
    expect(original.code).toBe(code);
    expect(makeRequest).toHaveBeenCalledExactlyOnceWith(...args);
    if (!(failure instanceof Error))
      throw new Error("Expected a transport error");
    const stripeError = new Stripe.errors.StripeConnectionError({
      message: "Connection failed",
      detail: failure,
    });
    expect(singleAttemptPortalError(stripeError)).toEqual({
      type: "StripeConnectionError",
      code,
      message: expect.stringContaining("unknown outcome"),
    });
  },
);

it("leaves timeouts, provider responses and unbranded error details unchanged", async () => {
  const timeout = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
  const response = { getStatusCode: () => 409 } as Stripe.HttpClientResponse;
  const makeRequest = vi
    .fn()
    .mockRejectedValueOnce(timeout)
    .mockResolvedValueOnce(response);
  const adapter = new SingleAttemptHttpClient({
    getClientName: () => "controlled",
    makeRequest,
  });
  await expect(adapter.makeRequest(...args)).rejects.toBe(timeout);
  expect(await adapter.makeRequest(...args)).toBe(response);
  const spoof = {
    type: "StripeConnectionError",
    detail: { transportCode: "ECONNRESET" },
  };
  expect(singleAttemptPortalError(spoof)).toBe(spoof);
  expect(singleAttemptPortalError(null)).toBeNull();
  expect(adapter.getClientName()).toBe("single-attempt:controlled");
});
