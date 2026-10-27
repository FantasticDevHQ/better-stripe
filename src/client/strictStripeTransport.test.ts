import { afterEach, it, expect, vi } from "vitest";
import Stripe from "stripe";
import { createServer } from "node:http";
import { getStripeClient } from "./helpers.js";
afterEach(() => vi.restoreAllMocks());
it.each([307, 308])(
  "shared singleAttempt factory sends onlyone POST on%s redirect",
  async (status) => {
    const requests: { path: string; method: string }[] = [];
    const server = createServer((req, res) => {
      requests.push({ path: req.url!, method: req.method! });
      req.resume();
      if (req.url?.startsWith("/v1/")) {
        res.writeHead(status, { Location: "/redirected" });
        res.end();
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "sub_sched_controlled",
            object: "subscription_schedule",
          }),
        );
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw Error("missingephemeralport");
    const original = Stripe.createFetchHttpClient.bind(Stripe);
    // Public Fetchfactory seam rewrites ONLY ownedloopback destination. The tested
    // factory owns redirectmode; this fixture deliberately does not set it.
    vi.spyOn(Stripe, "createFetchHttpClient").mockImplementation((fetchFn) =>
      original((url, init) => {
        const local = new URL(String(url));
        local.protocol = "http:";
        local.hostname = "127.0.0.1";
        local.port = String(addr.port);
        return (fetchFn ?? fetch)(local.toString(), init);
      }),
    );
    try {
      const stripe = getStripeClient(
        "sk_test_CONTROLLED_SHARED_" + status,
        "2026-09-30.endive",
        { singleAttempt: true },
      );
      await expect(
        stripe.subscriptionSchedules.update(
          "sub_sched_controlled",
          { end_behavior: "release" },
          { maxNetworkRetries: 0, idempotencyKey: "retained-controlled-key" },
        ),
      ).rejects.toMatchObject({ type: "StripeConnectionError" });
      expect(requests).toEqual([
        {
          path: "/v1/subscription_schedules/sub_sched_controlled",
          method: "POST",
        },
      ]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      expect(server.listening).toBe(false);
    }
  },
);
it("ordinary cached client remains on its normal transport factory path", () => {
  const factory = vi.spyOn(Stripe, "createFetchHttpClient");
  getStripeClient("sk_test_CONTROLLED_ORDINARY_UNCHANGED", "2026-09-30.endive");
  expect(factory).not.toHaveBeenCalled();
});
