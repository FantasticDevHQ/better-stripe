import type Stripe from "stripe";
export type MeteringDiagnostic = {
  status: number;
  code: string;
  param: string;
};
function label(value: unknown): string {
  return typeof value === "string" &&
    /^[a-z_][a-z_.[\]0-9]{0,79}$/.test(value) &&
    !/(secret|token|authorization|sk_test_|sk_live_|rk_test_|rk_live_)/.test(
      value,
    )
    ? value
    : "unspecified";
}
/** Observe the real SDK's parsed error classification without logging bodies, credentials or customer data. */
export function withMeteringDiagnostics(
  client: Stripe.HttpClient,
  report: (event: MeteringDiagnostic) => void,
): Stripe.HttpClient {
  const request = client.makeRequest.bind(client);
  client.makeRequest = async (
    ...args: Parameters<Stripe.HttpClient["makeRequest"]>
  ) => {
    const response = await request(...args);
    if (response.getStatusCode() >= 400) {
      const read = response.toJSON.bind(response);
      response.toJSON = async () => {
        const body = await read();
        const error =
          body &&
          typeof body === "object" &&
          "error" in body &&
          body.error &&
          typeof body.error === "object"
            ? (body.error as Record<string, unknown>)
            : {};
        report({
          status: response.getStatusCode(),
          code: label(error.code),
          param: label(error.param),
        });
        return body;
      };
    }
    return response;
  };
  return client;
}
