import { modules } from "../../test";
// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/**
 * Binding checks for the marketplace checkout and balance actions. The Stripe
 * seams are mocked: `../stripe/helpers` (the BetterStripe singleton) and the
 * `stripe` package (the raw client `getRecipientBalance` constructs).
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../stripe/helpers", () => ({
  stripe: {
    createCheckoutSession: vi.fn(),
    getAccountByUserId: vi.fn(),
    getAccountByStripeId: vi.fn(),
    getPriceByStripeId: vi.fn(),
    getProductByStripeId: vi.fn(),
  },
}));

const balanceRetrieve = vi.fn();
vi.mock("stripe", () => ({
  default: class FakeStripe {
    balance = { retrieve: balanceRetrieve };
  },
}));

import { api } from "../_generated/api";
import schema from "../schema";
import { stripe } from "../stripe/helpers";

const originalKey = process.env.STRIPE_SECRET_KEY;

beforeEach(() => {
  vi.resetAllMocks();
  process.env.STRIPE_SECRET_KEY = "sk_test_marketplace_actions";
  vi.mocked(stripe.getAccountByUserId).mockImplementation((async (
    _ctx: unknown,
    args: { userId: string },
  ) =>
    args.userId === "seller"
      ? { stripeAccountId: "acct_store" }
      : null) as never);
  vi.mocked(stripe.getPriceByStripeId).mockResolvedValue({
    stripePriceId: "price_store",
    stripeProductId: "prod_store",
  } as never);
  vi.mocked(stripe.getProductByStripeId).mockResolvedValue({
    stripeProductId: "prod_store",
    accountId: "acct_store",
  } as never);
  vi.mocked(stripe.createCheckoutSession).mockResolvedValue({
    stripeSessionId: "cs_test_1",
    clientSecret: "cs_secret",
  } as never);
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = originalKey;
});

describe("getRecipientBalance", () => {
  it("reads the balance for the caller's own account", async () => {
    balanceRetrieve.mockResolvedValue({
      available: [{ amount: 9000, currency: "usd" }],
      pending: [{ amount: 500, currency: "usd" }],
    });
    const t = convexTest(schema, modules);
    await expect(
      t.action(api.marketplace.actions.getRecipientBalance, {
        userId: "seller",
        stripeAccountId: "acct_store",
      }),
    ).resolves.toEqual({ available: 9000, pending: 500, currency: "usd" });
    expect(balanceRetrieve).toHaveBeenCalledWith(
      {},
      { stripeAccount: "acct_store" },
    );
  });

  it("refuses to read another account's balance", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.action(api.marketplace.actions.getRecipientBalance, {
        userId: "seller",
        stripeAccountId: "acct_foreign",
      }),
    ).rejects.toThrow(/Account not found for this user/);
    await expect(
      t.action(api.marketplace.actions.getRecipientBalance, {
        userId: "stranger",
        stripeAccountId: "acct_store",
      }),
    ).rejects.toThrow(/Account not found for this user/);
    expect(balanceRetrieve).not.toHaveBeenCalled();
  });
});

const checkoutActions = [
  [
    "createStoreSubscriptionCheckout",
    api.marketplace.actions.createStoreSubscriptionCheckout,
    {},
  ],
  [
    "createDestinationChargeCheckout",
    api.marketplace.actions.createDestinationChargeCheckout,
    { amount: 10_000 },
  ],
] as const;

describe.each(checkoutActions)(
  "%s destination binding",
  (_name, ref, extra) => {
    const base = {
      userId: "buyer",
      stripePriceId: "price_store",
      returnUrl: "https://example.com/return",
      ...extra,
    };

    it("creates the session when the destination sells the price", async () => {
      const t = convexTest(schema, modules);
      await t.action(ref, {
        ...base,
        destinationAccountId: "acct_store",
      } as never);
      expect(stripe.createCheckoutSession).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          stripePriceId: "price_store",
          destinationAccountId: "acct_store",
        }),
      );
    });

    it("refuses to route the price to a foreign destination account", async () => {
      const t = convexTest(schema, modules);
      await expect(
        t.action(ref, {
          ...base,
          destinationAccountId: "acct_foreign",
        } as never),
      ).rejects.toThrow(/Price not found for this destination account/);
      expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
    });

    it("refuses an unknown price and a platform-catalog product", async () => {
      const t = convexTest(schema, modules);
      const args = { ...base, destinationAccountId: "acct_store" } as never;
      vi.mocked(stripe.getPriceByStripeId).mockResolvedValueOnce(null as never);
      await expect(t.action(ref, args)).rejects.toThrow(/Price not found/);
      vi.mocked(stripe.getProductByStripeId).mockResolvedValueOnce({
        stripeProductId: "prod_store",
      } as never);
      await expect(t.action(ref, args)).rejects.toThrow(/Price not found/);
      expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
    });
  },
);
