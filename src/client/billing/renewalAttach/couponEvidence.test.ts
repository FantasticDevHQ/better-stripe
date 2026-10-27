import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import { joinRenewalCoupons } from "./couponJoins.js";
const apiVersion = "2026-09-30.endive";
const baseline = {
  id: "custom-offer",
  object: "coupon",
  livemode: false,
  duration: "forever",
  applies_to: { products: ["current", "target"] },
};
const expanded = (coupon: unknown, id = "di_original") => ({
  discounts: [{ id, object: "discount", source: { type: "coupon", coupon } }],
});
function controlled(value: unknown) {
  const calls: string[] = [];
  const stripe = new Stripe("sk_test_SYNTHETIC", {
    apiVersion,
    maxNetworkRetries: 0,
    httpClient: {
      getClientName: () => "controlled-coupon-evidence",
      async makeRequest(_host, _port, path, method) {
        calls.push(`${method} ${path}`);
        return {
          getStatusCode: () => 200,
          getHeaders: () => ({
            "request-id": "req_synthetic",
            "stripe-version": apiVersion,
          }),
          toJSON: async () => structuredClone(value),
          getRawResponse: () => ({}),
          toStream: () => null,
        } as unknown as Stripe.HttpClientResponse;
      },
    },
  });
  return {
    calls,
    join: (source: unknown, item: unknown = { discounts: [] }) =>
      joinRenewalCoupons(
        stripe,
        source as Record<string, unknown>,
        item as Record<string, unknown>,
        false,
        { apiVersion, maxNetworkRetries: 0 },
      ),
  };
}
describe("expanded coupon full evidence equality", () => {
  it.each([
    ["duration", { ...baseline, duration: "once" }, baseline],
    [
      "applicability",
      { ...baseline, applies_to: { products: ["current"] } },
      baseline,
    ],
    [
      "original-only unknown fact",
      { ...baseline, unknown_provider_fact: { retained: "original" } },
      baseline,
    ],
    [
      "minimal expanded reference",
      { id: baseline.id, object: "coupon" },
      baseline,
    ],
    [
      "fresh-only unknown fact",
      baseline,
      { ...baseline, unknown_provider_fact: "fresh" },
    ],
    [
      "ordered applicability",
      { ...baseline, applies_to: { products: ["target", "current"] } },
      baseline,
    ],
  ])(
    "rejects %s drift instead of replacing original facts",
    async (_label, original, fetched) => {
      const h = controlled(fetched);
      await expect(h.join(expanded(original))).rejects.toThrow();
      expect(h.calls).toEqual(["GET /v1/coupons/custom-offer"]);
    },
  );
  it("retains full equal unknown facts and tolerates object-key order", async () => {
    const extra = { nested: ["retained", 0] };
    const original = { ...baseline, unknown_provider_fact: extra };
    const fetched = { unknown_provider_fact: extra, ...baseline };
    const h = controlled(fetched);
    const result = await h.join(expanded(original));
    expect(result.subscriptionDiscounts[0].source.coupon).toEqual(original);
    expect(h.calls).toHaveLength(1);
  });
  it("checks every expanded reference even when the coupon GET is deduplicated", async () => {
    const h = controlled(baseline);
    await expect(
      h.join(
        expanded(baseline),
        expanded({ ...baseline, duration: "once" }, "di_item"),
      ),
    ).rejects.toThrow();
    expect(h.calls).toHaveLength(1);
  });
});
