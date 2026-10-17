import Stripe from "stripe";
import { expect, it } from "vitest";
import { STRIPE_CUSTOMER_PREVIEW_API_VERSION } from "../apiVersion.js";
import * as funding from "../billing/balanceFunding.js";

function fixture(sdkVersion: string = STRIPE_CUSTOMER_PREVIEW_API_VERSION) {
  const requests: { method: string; path: string; version: string | null }[] =
    [];
  const subscription = {
    id: "sub_plan",
    object: "subscription",
    customer_account: "acct_owner",
    status: "active",
    default_payment_method: "pm_card",
    payment_settings: { payment_method_types: ["card"] },
  };
  const method = {
    id: "pm_card",
    object: "payment_method",
    type: "card",
    customer_account: "acct_owner",
  };
  const stripe = new Stripe("sk_test_capture_fixture", {
    apiVersion: sdkVersion as Stripe.LatestApiVersion,
    maxNetworkRetries: 0,
    httpClient: Stripe.createFetchHttpClient(async (url, init) => {
      const path = new URL(String(url)).pathname;
      requests.push({
        method: init?.method ?? "GET",
        path,
        version: new Headers(init?.headers).get("Stripe-Version"),
      });
      return new Response(
        JSON.stringify(path.includes("subscriptions") ? subscription : method),
        { status: 200 },
      );
    }),
  });
  const capture = (
    version = STRIPE_CUSTOMER_PREVIEW_API_VERSION,
    consent = true,
  ) => {
    return funding.captureBalanceFundingOriginal(stripe, version, {
      customerAccount: "acct_owner",
      stripeSubscriptionId: "sub_plan",
      consent: consent as true,
    });
  };
  return { capture, subscription, method, requests };
}

it("captures immutable original settings through read-only preview SDK calls before provisioning", async () => {
  const s = fixture();
  expect(await s.capture()).toEqual({
    customerAccount: "acct_owner",
    stripeSubscriptionId: "sub_plan",
    previousPaymentMethodId: "pm_card",
    previousPaymentMethodTypes: ["card"],
  });
  expect(s.requests).toEqual([
    {
      method: "GET",
      path: "/v1/subscriptions/sub_plan",
      version: STRIPE_CUSTOMER_PREVIEW_API_VERSION,
    },
    {
      method: "GET",
      path: "/v1/payment_methods/pm_card",
      version: STRIPE_CUSTOMER_PREVIEW_API_VERSION,
    },
  ]);
});

it("preserves null versus empty restoration settings", async () => {
  for (const types of [null, []]) {
    const s = fixture();
    Object.assign(s.subscription, {
      default_payment_method: null,
      payment_settings: { payment_method_types: types },
    });
    expect(await s.capture()).toMatchObject({
      previousPaymentMethodId: null,
      previousPaymentMethodTypes: types,
    });
    expect(s.requests).toHaveLength(1);
  }
});

it("requires explicit preview configuration and consent before provider reads", async () => {
  const s = fixture();
  await expect(
    s.capture(
      "2026-02-25.clover" as typeof STRIPE_CUSTOMER_PREVIEW_API_VERSION,
    ),
  ).rejects.toThrow(/preview/i);
  await expect(s.capture(undefined, false)).rejects.toThrow(/consent/i);
  expect(s.requests).toHaveLength(0);
});

it("refuses recapture when balance funding is already configured", async () => {
  const settings = fixture();
  settings.subscription.payment_settings.payment_method_types = [
    "stripe_balance",
  ];
  await expect(settings.capture()).rejects.toThrow(/persisted restoration/i);
  const method = fixture();
  method.method.type = "stripe_balance";
  await expect(method.capture()).rejects.toThrow(/persisted restoration/i);
  expect(
    [...settings.requests, ...method.requests].every((r) => r.method === "GET"),
  ).toBe(true);
});

it("rejects foreign or inactive subscriptions before any provider write", async () => {
  const foreign = fixture();
  foreign.subscription.customer_account = "acct_foreign";
  await expect(foreign.capture()).rejects.toThrow(/belong/i);
  const inactive = fixture();
  inactive.subscription.status = "canceled";
  await expect(inactive.capture()).rejects.toThrow(/cannot change/i);
  expect(
    [...foreign.requests, ...inactive.requests].every(
      (r) => r.method === "GET",
    ),
  ).toBe(true);
});

it("rejects a version argument that disagrees with the actual configured SDK", async () => {
  const s = fixture("2026-02-25.clover");
  await expect(s.capture()).rejects.toThrow(/preview|version/i);
  expect(s.requests).toHaveLength(0);
});

it("verifies the captured subscription and original payment method identities", async () => {
  const subscription = fixture();
  subscription.subscription.id = "sub_foreign";
  await expect(subscription.capture()).rejects.toThrow(/identity|match/i);
  const method = fixture();
  method.method.id = "pm_foreign";
  await expect(method.capture()).rejects.toThrow(/identity|match/i);
  const owner = fixture();
  owner.method.customer_account = "acct_foreign";
  await expect(owner.capture()).rejects.toThrow(/belong|identity/i);
});
