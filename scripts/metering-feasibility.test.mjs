import { describe, expect, it } from "vitest";
import { probeMetering } from "./metering-feasibility.mjs";

describe("metering feasibility probe", () => {
  it.each([undefined, "sk_live_invalid", "rk_live_invalid", "garbage"])(
    "rejects non-test credentials before making a request",
    async (apiKey) => {
      let calls = 0;
      await expect(
        probeMetering({
          apiKey,
          request: async () => {
            calls++;
          },
        }),
      ).rejects.toThrow("test-mode secret key");
      expect(calls).toBe(0);
    },
  );

  it("only reads meter capabilities and emits sanitized facts", async () => {
    const requests = [];
    const result = await probeMetering({
      apiKey: "sk_test_fixture",
      request: async (url, options) => {
        requests.push({ url, options });
        return new Response(
          JSON.stringify({
            data: [{ id: "private_id", event_name: "private_name" }],
            has_more: true,
          }),
          { status: 200 },
        );
      },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(
      "https://api.stripe.com/v1/billing/meters?limit=1",
    );
    expect(requests[0].options.method).toBe("GET");
    expect(result).toMatchObject({
      provider: "stripe-billing-meters",
      status: 200,
      accessible: true,
    });
    expect(JSON.stringify(result)).not.toMatch(/private|sk_test_fixture/);
  });

  it("does not leak provider errors or treat access denial as incompatibility", async () => {
    const result = await probeMetering({
      apiKey: "sk_test_fixture",
      request: async () =>
        new Response(
          JSON.stringify({ error: { message: "private payload" } }),
          { status: 403 },
        ),
    });
    expect(result).toMatchObject({
      status: 403,
      accessible: false,
      accountIdentity: "unverified",
    });
    expect(JSON.stringify(result)).not.toContain("private");
  });
});
