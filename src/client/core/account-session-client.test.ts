import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { components } from "../setup.test.js";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("stripe", () => ({
  default: class {
    accountSessions = { create };
  },
}));
const { BetterStripe } = await import("../index.js");
const mockCtx = { runQuery: vi.fn(), runMutation: vi.fn(), runAction: vi.fn() };
beforeEach(() => vi.resetAllMocks());

describe("createAccountSession", () => {
  it("returns the provider client secret and expiry through BetterStripe", async () => {
    const bs = new BetterStripe(components.betterStripe, {
      STRIPE_SECRET_KEY: "sk_test_xxx",
    });

    create.mockResolvedValue({
      client_secret: "as_secret_123",
      expires_at: 1234567890,
    });

    const result = await bs.createAccountSession(mockCtx, {
      stripeAccountId: "acct_123",
      components: {
        account_management: { enabled: true },
      },
    });

    expect(create).toHaveBeenCalledWith({
      account: "acct_123",
      components: {
        account_management: { enabled: true },
      },
    });
    expect(result).toEqual({
      clientSecret: "as_secret_123",
      expiresAt: 1234567890,
    });
  });

  it("wraps Stripe failures in a structured STRIPE_API_ERROR", async () => {
    const bs = new BetterStripe(components.betterStripe, {
      STRIPE_SECRET_KEY: "sk_test_xxx",
    });

    create.mockRejectedValue(
      Object.assign(new Error("No such account: acct_missing"), {
        type: "StripeInvalidRequestError",
        code: "resource_missing",
      }),
    );

    const error = await bs
      .createAccountSession(mockCtx, {
        stripeAccountId: "acct_missing",
        components: { account_onboarding: { enabled: true } },
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConvexError);
    expect((error as { data: Record<string, unknown> }).data).toMatchObject({
      code: "STRIPE_API_ERROR",
      stripeError: {
        type: "StripeInvalidRequestError",
        code: "resource_missing",
        message: "No such account: acct_missing",
      },
    });
  });
});
