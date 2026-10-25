import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { BetterStripe, type BetterStripeComponent } from "../index.js";
import type { RunCtx } from "../helpers.js";
import {
  createBillingPortalConfiguration,
  retrieveBillingPortalConfiguration,
  updateBillingPortalConfiguration,
  createBillingPortalSession,
} from "./accountLinks.js";
const ctx = {} as RunCtx;
function makeStripe() {
  return {
    billingPortal: {
      configurations: { create: vi.fn(), retrieve: vi.fn(), update: vi.fn() },
      sessions: { create: vi.fn() },
    },
  };
}
const asStripe = (stripe: ReturnType<typeof makeStripe>) =>
  stripe as unknown as Stripe;

describe("Billing Portal configurations", () => {
  const params = {
    features: {
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price" as const],
        products: [
          { product: "prod_host", prices: ["price_current", "price_legacy"] },
        ],
        proration_behavior: "always_invoice" as const,
      },
      subscription_cancel: { enabled: true, mode: "at_period_end" as const },
    },
  };

  it.each([undefined, "acct_connected"])(
    "creates a host-configured policy in scope %s",
    async (connectedAccountId) => {
      const stripe = makeStripe();
      const configuration = { id: "bpc_host", ...params };
      stripe.billingPortal.configurations.create.mockResolvedValue(
        configuration,
      );
      const result = await createBillingPortalConfiguration(
        asStripe(stripe),
        ctx,
        { params, connectedAccountId },
      );
      expect(result).toEqual(configuration);
      expect(stripe.billingPortal.configurations.create.mock.calls[0]).toEqual(
        connectedAccountId
          ? [params, { stripeAccount: connectedAccountId }]
          : [params],
      );
    },
  );

  it.each([undefined, "acct_connected"])(
    "retrieves a configuration in scope %s",
    async (connectedAccountId) => {
      const stripe = makeStripe();
      stripe.billingPortal.configurations.retrieve.mockResolvedValue({
        id: "bpc_host",
        ...params,
      });
      const result = await retrieveBillingPortalConfiguration(
        asStripe(stripe),
        ctx,
        { configurationId: "bpc_host", connectedAccountId },
      );
      expect(result.id).toBe("bpc_host");
      expect(
        stripe.billingPortal.configurations.retrieve.mock.calls[0],
      ).toEqual(
        connectedAccountId
          ? ["bpc_host", {}, { stripeAccount: connectedAccountId }]
          : ["bpc_host"],
      );
    },
  );

  it.each([undefined, "acct_connected"])(
    "updates a configuration in scope %s",
    async (connectedAccountId) => {
      const stripe = makeStripe();
      const update = { active: false, ...params };
      stripe.billingPortal.configurations.update.mockResolvedValue({
        id: "bpc_host",
        ...update,
      });
      const result = await updateBillingPortalConfiguration(
        asStripe(stripe),
        ctx,
        { configurationId: "bpc_host", params: update, connectedAccountId },
      );
      expect(result.active).toBe(false);
      expect(stripe.billingPortal.configurations.update.mock.calls[0]).toEqual(
        connectedAccountId
          ? ["bpc_host", update, { stripeAccount: connectedAccountId }]
          : ["bpc_host", update],
      );
    },
  );

  it.each(["create", "retrieve", "update"] as const)(
    "reports %s provider errors without an unscoped fallback",
    async (operation) => {
      const stripe = makeStripe();
      stripe.billingPortal.configurations[operation].mockRejectedValue({
        type: "StripeInvalidRequestError",
        code: "resource_missing",
        message: "Configuration unavailable in this account",
      });
      const opts = {
        configurationId: "bpc_missing",
        params,
        connectedAccountId: "acct_connected",
      };
      const methods = {
        create: createBillingPortalConfiguration,
        retrieve: retrieveBillingPortalConfiguration,
        update: updateBillingPortalConfiguration,
      };
      await expect(
        methods[operation](asStripe(stripe), ctx, opts),
      ).rejects.toMatchObject({
        data: {
          code: "STRIPE_API_ERROR",
          stripeError: { code: "resource_missing" },
        },
      });
      expect(
        stripe.billingPortal.configurations[operation],
      ).toHaveBeenCalledTimes(1);
    },
  );
});

describe("configured Billing Portal sessions", () => {
  it.each([undefined, "acct_connected"])(
    "selects the configuration and customer account in scope %s",
    async (connectedAccountId) => {
      const stripe = makeStripe();
      stripe.billingPortal.sessions.create.mockResolvedValue({
        url: "https://portal",
      });
      const result = await createBillingPortalSession(asStripe(stripe), ctx, {
        stripeAccountId: "acct_customer",
        returnUrl: "https://return",
        configurationId: "bpc_host",
        connectedAccountId,
      });
      expect(result).toEqual({ url: "https://portal" });
      const params = {
        customer_account: "acct_customer",
        return_url: "https://return",
        configuration: "bpc_host",
      };
      expect(stripe.billingPortal.sessions.create.mock.calls[0]).toEqual([
        params,
        {
          ...(connectedAccountId ? { stripeAccount: connectedAccountId } : {}),
          maxNetworkRetries: 0,
        },
      ]);
    },
  );

  it("reports a provider error without retrying against platform scope", async () => {
    const stripe = makeStripe();
    stripe.billingPortal.sessions.create.mockRejectedValue({
      type: "StripeInvalidRequestError",
      code: "resource_missing",
      message: "No such configuration",
    });
    await expect(
      createBillingPortalSession(asStripe(stripe), ctx, {
        stripeAccountId: "acct_customer",
        returnUrl: "https://return",
        configurationId: "bpc_missing",
        connectedAccountId: "acct_connected",
      }),
    ).rejects.toMatchObject({
      data: {
        code: "STRIPE_API_ERROR",
        stripeError: { code: "resource_missing" },
      },
    });
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledTimes(1);
  });
});

describe("BetterStripe portal API", () => {
  it("exposes configuration lifecycle and configured sessions through the client", async () => {
    const stripe = makeStripe();
    class TestClient extends BetterStripe {
      protected stripe() {
        return asStripe(stripe);
      }
    }
    const client = new TestClient({} as BetterStripeComponent);
    const params = { features: { invoice_history: { enabled: true } } };
    const opts = {
      configurationId: "bpc_client",
      params,
      connectedAccountId: "acct_owner",
    };
    stripe.billingPortal.configurations.create.mockResolvedValue({
      id: "bpc_client",
    });
    stripe.billingPortal.configurations.retrieve.mockResolvedValue({
      id: "bpc_client",
    });
    stripe.billingPortal.configurations.update.mockResolvedValue({
      id: "bpc_client",
      active: false,
    });
    stripe.billingPortal.sessions.create.mockResolvedValue({
      url: "https://portal",
    });
    expect(await client.createBillingPortalConfiguration(ctx, opts)).toEqual({
      id: "bpc_client",
    });
    expect(await client.retrieveBillingPortalConfiguration(ctx, opts)).toEqual({
      id: "bpc_client",
    });
    expect(await client.updateBillingPortalConfiguration(ctx, opts)).toEqual({
      id: "bpc_client",
      active: false,
    });
    expect(
      await client.createBillingPortalSession(ctx, {
        ...opts,
        stripeAccountId: "acct_customer",
        returnUrl: "https://return",
      }),
    ).toEqual({ url: "https://portal" });
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith(
      {
        configuration: "bpc_client",
        customer_account: "acct_customer",
        return_url: "https://return",
      },
      { stripeAccount: "acct_owner", maxNetworkRetries: 0 },
    );
  });
});
