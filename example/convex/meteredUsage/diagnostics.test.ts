import Stripe from "stripe";
import { expect, it } from "vitest";
import * as diagnostics from "./diagnostics";
it("reports only sanitized native failure classification while preserving the actual SDK response", async () => {
  expect(diagnostics.withMeteringDiagnostics).toBeTypeOf("function");
  const reports: unknown[] = [];
  const client = Stripe.createFetchHttpClient(
    async () =>
      new Response(
        JSON.stringify({
          error: {
            type: "invalid_request_error",
            code: "timestamp_in_future",
            param: "timestamp",
            message: "private provider message",
          },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
  );
  const stripe = new Stripe("sk_test_mock", {
    maxNetworkRetries: 0,
    httpClient: diagnostics.withMeteringDiagnostics(client, (event) =>
      reports.push(event),
    ),
  });
  await expect(
    stripe.billing.meterEvents.create({
      event_name: "calls",
      identifier: "original",
      timestamp: 700,
      payload: { stripe_customer_id: "cus_test", value: "5" },
    }),
  ).rejects.toThrow("private provider message");
  expect(reports).toEqual([
    { status: 400, code: "timestamp_in_future", param: "timestamp" },
  ]);
  expect(JSON.stringify(reports)).not.toContain("private");
});
it("does not log untrusted messages, credential-like codes or customer data in a parameter", async () => {
  expect(diagnostics.withMeteringDiagnostics).toBeTypeOf("function");
  const reports: unknown[] = [];
  const client = Stripe.createFetchHttpClient(
    async () =>
      new Response(
        JSON.stringify({
          error: {
            type: "invalid_request_error",
            code: "secret_token",
            param: "private@example.invalid",
            message: "private provider message",
          },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
  );
  const stripe = new Stripe("sk_test_mock", {
    maxNetworkRetries: 0,
    httpClient: diagnostics.withMeteringDiagnostics(client, (event) =>
      reports.push(event),
    ),
  });
  await expect(stripe.accounts.retrieve(null)).rejects.toThrow();
  expect(reports).toEqual([
    { status: 400, code: "unspecified", param: "unspecified" },
  ]);
});
