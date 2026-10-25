import Stripe from "stripe";
import { componentsGeneric } from "convex/server";
import { expect, it, vi } from "vitest";
import {
  BetterStripe,
  prepareBillingPortalSessionRequestIdentity,
  type BetterStripeOptions,
} from "./index.js";
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
type TransportFailure =
  "retryable" | "conflict" | "mismatch" | "ECONNRESET" | "EPIPE" | "ETIMEDOUT";
function fixture(
  version: string | undefined,
  portalFailure?: TransportFailure,
  failureTarget: "portal" | "subscription" = "portal",
) {
  const key = `sk_test_preview_transport_${crypto.randomUUID()}`;
  const bs = new BetterStripe(component, {
    STRIPE_SECRET_KEY: key,
    ...(version === undefined ? {} : { stripeApiVersion: version }),
  } as BetterStripeOptions);
  const calls: {
    path: string;
    version: string;
    idempotency: string | undefined;
    connectedAccount: string | undefined;
    body: string;
  }[] = [];
  for (const selected of new Set([version, "2026-09-30.endive"])) {
    const sdk = getStripeClient(key, selected);
    const transport = {
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
          connectedAccount: headers["Stripe-Account"] as string | undefined,
          body: String(body),
        });
        if (
          portalFailure &&
          path.includes(
            failureTarget === "portal"
              ? "/billing_portal/sessions"
              : "/subscriptions/",
          )
        ) {
          if (!["retryable", "conflict", "mismatch"].includes(portalFailure))
            throw Object.assign(
              new Error("Controlled socket closure; outcome unknown"),
              { code: portalFailure },
            );
          return {
            getStatusCode: () =>
              portalFailure === "conflict"
                ? 409
                : portalFailure === "mismatch"
                  ? 400
                  : 500,
            getHeaders: () => ({ "stripe-should-retry": "true" }),
            getRawResponse: () => ({}),
            toJSON: async () => ({
              error: {
                type: ["conflict", "mismatch"].includes(portalFailure)
                  ? "idempotency_error"
                  : "api_error",
                code:
                  portalFailure === "conflict"
                    ? "idempotency_key_in_use"
                    : portalFailure === "mismatch"
                      ? "idempotency_mismatch"
                      : "upstream_failure",
                message: "Controlled provider error",
              },
            }),
            toStream: () => {
              throw new Error("Unexpected stream");
            },
          };
        }
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
                              object: "subscription",
                              status: "active",
                              customer_account: "acct_buyer",
                              items: {
                                has_more: false,
                                data: [
                                  {
                                    id: "si_preview",
                                    price: {
                                      id: "price_preview",
                                      product: "prod_preview",
                                    },
                                  },
                                ],
                              },
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
    };
    (
      sdk as unknown as { _setApiField: (name: string, value: unknown) => void }
    )._setApiField("httpClient", transport);
    // Inject below the production adapter, so a test cannot bypass its guard.
    const fetchFactory = vi
      .spyOn(Stripe, "createFetchHttpClient")
      .mockReturnValue(transport);
    try {
      const portal = getStripeClient(key, selected, { singleAttempt: true });
      expect(portal).not.toBe(sdk);
      expect(portal.getApiField("maxNetworkRetries")).toBe(0);
      expect(portal.getApiField("version")).toBe(sdk.getApiField("version"));
    } finally {
      fetchFactory.mockRestore();
    }
  }
  return { bs, calls };
}
it.each([
  "retryable",
  "conflict",
  "mismatch",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
] as const)(
  "makes one real Stripe-client HTTP attempt for a portal %s failure",
  async (failure) => {
    const { bs, calls } = fixture(undefined, failure);
    const options = {
      stripeAccountId: "acct_buyer",
      connectedAccountId: "acct_connected",
      configurationId: "bpc_policy",
      returnUrl: "https://example.com/billing",
    };
    const requestIdentity = prepareBillingPortalSessionRequestIdentity(
      options,
      "portal:http-original",
    );
    await expect(
      bs.createBillingPortalSession(ctx, { ...options, requestIdentity }),
    ).rejects.toMatchObject({
      data: {
        code: "STRIPE_API_ERROR",
        stripeError: {
          type:
            failure === "mismatch"
              ? "StripeIdempotencyError"
              : failure === "retryable" || failure === "conflict"
                ? "StripeAPIError"
                : "StripeConnectionError",
          ...(failure === "conflict" ? { code: "idempotency_key_in_use" } : {}),
          ...(failure === "mismatch" ? { code: "idempotency_mismatch" } : {}),
          ...(failure === "ECONNRESET" || failure === "EPIPE"
            ? {
                code: failure,
                message: expect.stringContaining("unknown outcome"),
              }
            : {}),
        },
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      path: "/v1/billing_portal/sessions",
      connectedAccount: "acct_connected",
      idempotency: "portal:http-original",
    });
    expect(new URLSearchParams(calls[0]!.body).get("customer_account")).toBe(
      "acct_buyer",
    );
  },
);
it.each(["ECONNRESET", "EPIPE", "ETIMEDOUT"] as const)(
  "does not replay a targeted subscription read after %s",
  async (failure) => {
    const { bs, calls } = fixture(undefined, failure, "subscription");
    const options = {
      stripeAccountId: "acct_buyer",
      connectedAccountId: "acct_connected",
      returnUrl: "https://example.com/billing",
      flowData: {
        type: "subscription_update_confirm" as const,
        subscription_update_confirm: {
          subscription: "sub_preview",
          items: [{ id: "si_preview", price: "price_next" }] as [
            { id: string; price: string },
          ],
        },
      },
    };
    const requestIdentity = prepareBillingPortalSessionRequestIdentity(
      options,
      "portal:get-original",
    );
    await expect(
      bs.createBillingPortalSession(ctx, { ...options, requestIdentity }),
    ).rejects.toMatchObject({
      data: {
        code: "STRIPE_API_ERROR",
        stripeError: { type: "StripeConnectionError" },
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      path: "/v1/subscriptions/sub_preview",
      connectedAccount: "acct_connected",
      idempotency: undefined,
    });
  },
);
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
it("isolates portal transport policy from caller-controlled API version cache keys", () => {
  const key = `sk_test_cache_${crypto.randomUUID()}`;
  const normal = getStripeClient(key, "2026-09-30.endive:single-attempt");
  const portal = getStripeClient(key, "2026-09-30.endive", {
    singleAttempt: true,
  });
  expect(portal).not.toBe(normal);
  expect(portal.getApiField("version")).toBe("2026-09-30.endive");
  expect(portal.getApiField("maxNetworkRetries")).toBe(0);
});
