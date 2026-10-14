import Stripe from "stripe";
import { componentsGeneric } from "convex/server";
import { expect, it, vi } from "vitest";
import { BetterStripe, type BetterStripeOptions } from "./index.js";
import { getStripeClient, type Component, type RunCtx } from "./helpers.js";

const preview = "2026-09-30.preview";
const component = componentsGeneric().betterStripe as unknown as Component;
const ctx = {
  runQuery: vi.fn().mockImplementation(async (_ref, args) =>
    args?.stripeAccountId
      ? {
          _id: "row",
          userId: "buyer",
          stripeAccountId: "acct_buyer",
          appliedConfigurations: [],
        }
      : null,
  ),
  runMutation: vi.fn().mockResolvedValue("row"),
} as unknown as RunCtx;
function fixture(version: string | undefined) {
  const key = `sk_test_preview_transport_${crypto.randomUUID()}`;
  const bs = new BetterStripe(component, {
    STRIPE_SECRET_KEY: key,
    ...(version === undefined ? {} : { stripeApiVersion: version }),
  } as BetterStripeOptions);
  const calls: {
    path: string;
    version: string;
    idempotency: string | undefined;
    body: string;
  }[] = [];
  for (const selected of new Set([version, "2026-09-30.endive"])) {
    const sdk = getStripeClient(key, selected);
    (
      sdk as unknown as { _setApiField: (name: string, value: unknown) => void }
    )._setApiField("httpClient", {
      getClientName: () => "preview-contract-test",
      makeRequest: async (
        ...[, , path, , headers, body]: Parameters<
          ReturnType<typeof Stripe.createNodeHttpClient>["makeRequest"]
        >
      ) => {
        calls.push({
          path,
          version: String(headers["Stripe-Version"]),
          idempotency: headers["Idempotency-Key"] as string | undefined,
          body: String(body),
        });
        const data = path.includes("/checkout/sessions")
          ? {
              id: "cs_preview",
              object: "checkout.session",
              client_secret: "test_secret",
              status: "open",
            }
          : path.includes("/v2/core/accounts")
            ? {
                id: "acct_buyer",
                object: "v2.core.account",
                applied_configurations: ["customer"],
                configuration: { customer: {} },
                metadata: { userId: "buyer" },
              }
            : path.includes("/prices/")
              ? {
                  id: "price_preview",
                  active: true,
                  unit_amount: 1000,
                  currency: "usd",
                  type: "one_time",
                  product: "prod_preview",
                }
              : path.includes("/products/")
                ? { id: "prod_preview", active: true }
                : path.includes("/billing_portal/sessions")
                  ? {
                      id: "bps_preview",
                      url: "https://billing.stripe.com/test",
                    }
                  : path.includes("/refunds")
                    ? { id: "re_preview", status: "succeeded" }
                    : path.includes("/payment_intents/")
                      ? {
                          id: "pi_preview",
                          latest_charge: {
                            id: "ch_preview",
                            amount: 1000,
                            currency: "usd",
                          },
                        }
                      : path.includes("/charges/")
                        ? { id: "ch_preview", amount: 1000, currency: "usd" }
                        : path.includes("/coupons/")
                          ? { id: "coupon_preview", valid: true }
                          : {
                              id: "sub_preview",
                              status: "active",
                              customer_account: "acct_buyer",
                              items: { data: [] },
                              metadata: {},
                            };
        return {
          getStatusCode: () => 200,
          getHeaders: () => ({}),
          getRawResponse: () => ({}),
          toJSON: async () => data,
          toStream: () => {
            throw new Error("Unexpected stream");
          },
        };
      },
    });
  }
  return { bs, calls };
}
it.each([undefined, preview])(
  "uses one selected version for account, Checkout, billing, refunds and authoritative reads (%s)",
  async (version) => {
    const { bs, calls } = fixture(version);
    await bs.ensureCustomerAccount(ctx, {
      userId: "buyer",
      email: "buyer@example.com",
      idempotencyKey: "account:buyer",
    });
    await bs.createCheckoutSession(ctx, {
      userId: "buyer",
      accountId: "acct_buyer",
      stripePriceId: "price_preview",
      mode: "payment",
      returnUrl: "https://example.com/receipt",
      idempotencyKey: "order:one",
    });
    await bs.getCheckoutSessionFromStripe(ctx, {
      stripeSessionId: "cs_preview",
    });
    await bs.getSubscriptionFromStripe(ctx, {
      stripeSubscriptionId: "sub_preview",
    });
    await bs.getCouponFromStripe(ctx, { stripeCouponId: "coupon_preview" });
    await bs.cancelSubscription(ctx, { stripeSubscriptionId: "sub_preview" });
    await bs.reactivateSubscription(ctx, {
      stripeSubscriptionId: "sub_preview",
    });
    await bs.createBillingPortalSession(ctx, {
      stripeAccountId: "acct_buyer",
      returnUrl: "https://example.com/billing",
    });
    await bs.createRefund(ctx, {
      stripeChargeId: "ch_preview",
      idempotencyKey: "refund:one",
    });
    expect(calls.length).toBeGreaterThanOrEqual(8);
    expect(new Set(calls.map((c) => c.version))).toEqual(
      new Set([version ?? "2026-09-30.endive"]),
    );
    expect(calls.find((c) => c.path === "/v2/core/accounts")?.idempotency).toBe(
      "account:buyer",
    );
    expect(
      calls.find((c) => c.path === "/v1/checkout/sessions" && c.idempotency)
        ?.idempotency,
    ).toBe("order:one");
    expect(
      calls.find((c) => c.path === "/v1/checkout/sessions" && c.idempotency)
        ?.body,
    ).toContain("customer_account=acct_buyer");
    expect(
      calls.find((c) => c.path === "/v2/core/accounts")?.body,
    ).not.toContain("merchant");
    expect(bs.stripeApiVersion).toBe(version ?? "2026-09-30.endive");
  },
);
it.each(["", "2020-08-27", "2026-09-30.preview; unsafe", "not-a-version"])(
  "rejects unsupported client versions clearly (%s)",
  (version) => {
    expect(
      () =>
        new BetterStripe(component, {
          stripeApiVersion: version,
        } as unknown as BetterStripeOptions),
    ).toThrow("Unsupported Stripe API version");
  },
);
