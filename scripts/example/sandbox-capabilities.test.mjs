import { expect, it, vi } from "vitest";
import { failure, probeCapabilities } from "./sandbox-capabilities.mjs";

it.each([undefined, "sk_live_secret", "rkcs_live_secret", "malformed"])(
  "rejects non-test credentials before making a request: %s",
  async (key) => {
    const client = vi.fn();
    await expect(probeCapabilities(key, client)).rejects.toThrow("test key");
    expect(client).not.toHaveBeenCalled();
  },
);

it("keeps probing independent APIs after permission failures and redacts responses", async () => {
  const denied = async () => {
    throw Object.assign(new Error("rkcs_test_private customer@example.com"), {
      type: "StripePermissionError",
      code: "forbidden",
      statusCode: 403,
    });
  };
  const ok = vi.fn(async () => ({
    id: "private",
    url: "https://private",
    livemode: false,
  }));
  const cancel = vi.fn(async () => ({}));
  const stripe = {
    accounts: { retrieve: denied },
    v2: { core: { accounts: { create: denied } } },
    customers: { create: ok },
    prices: { create: ok },
    checkout: { sessions: { create: ok, expire: cancel } },
    subscriptions: { create: ok, cancel },
    transfers: { create: vi.fn(), createReversal: cancel },
    payouts: { create: denied, cancel },
    products: { create: ok, update: cancel },
  };
  const report = await probeCapabilities("rkcs_test_private", () => stripe);
  expect(report.results.accountsV2.httpStatus).toBe(403);
  expect(report.results.subscription.status).toBe("pass");
  expect(report.results.transfer.status).toBe("blocked");
  expect(stripe.transfers.create).not.toHaveBeenCalled();
  expect(cancel).toHaveBeenCalledTimes(3);
  expect(report.existingAdminGuardAcceptsKey).toBe(false);
  expect(JSON.stringify(report)).not.toMatch(/private|example.com|https/);
});

it("does not label a live response as supported", async () => {
  const live = async () => ({ livemode: true });
  const stripe = {
    accounts: { retrieve: live },
    v2: { core: { accounts: { create: live } } },
    customers: { create: live },
    prices: { create: live },
    checkout: { sessions: { create: live } },
    payouts: { create: live },
    products: { create: live },
  };
  const report = await probeCapabilities("sk_test_fake", () => stripe);
  expect(Object.values(report.results).every((x) => x.status !== "pass")).toBe(
    true,
  );
});

it("excludes provider message, headers and body from failure evidence", () => {
  expect(
    failure({
      message: "secret",
      headers: { authorization: "secret" },
      raw: "secret",
    }),
  ).toEqual({
    status: "fail",
    type: "Error",
    code: "unknown",
    httpStatus: null,
  });
});
