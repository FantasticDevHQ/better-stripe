import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STRIPE_DASHBOARD_BASE_URL,
  StripeDashboardResourcePath,
  getStripeDashboardUrl,
  isStripeTestMode,
} from "./stripeDashboardUrl.js";

describe("stripe dashboard helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exports the dashboard resource paths", () => {
    expect(StripeDashboardResourcePath.Product).toBe("products");
    expect(StripeDashboardResourcePath.Price).toBe("prices");
    expect(StripeDashboardResourcePath.Customer).toBe("customers");
    expect(StripeDashboardResourcePath.Subscription).toBe("subscriptions");
  });

  it("uses the Stripe dashboard base URL", () => {
    expect(STRIPE_DASHBOARD_BASE_URL).toBe("https://dashboard.stripe.com");
  });

  it("prefers an explicit mode argument when one is provided", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_123");

    expect(isStripeTestMode("test")).toBe(true);
  });

  it("falls back to STRIPE_SECRET_KEY when no explicit mode is provided", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");

    expect(isStripeTestMode()).toBe(true);
  });

  it("falls back to STRIPE_PUBLISHABLE_KEY when no explicit mode is provided", () => {
    vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "pk_test_123");

    expect(isStripeTestMode()).toBe(true);
  });

  it("falls back to NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY when no explicit mode is provided", () => {
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_123");

    expect(isStripeTestMode()).toBe(true);
  });

  it("prefers an explicit live mode over inferred test mode", () => {
    vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "pk_test_123");

    expect(isStripeTestMode("live")).toBe(false);
  });

  it("returns a live dashboard URL when neither env indicates test mode", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_123");

    expect(getStripeDashboardUrl("product", "prod_123")).toBe(
      `${STRIPE_DASHBOARD_BASE_URL}/products/prod_123`,
    );
  });

  it("returns a test dashboard URL when the environment is in test mode", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");

    expect(getStripeDashboardUrl("price", "price_123")).toBe(
      `${STRIPE_DASHBOARD_BASE_URL}/test/prices/price_123`,
    );
  });
});
