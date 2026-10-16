import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionCtx } from "./_generated/server";
import {
  ensure,
  participants,
  fixturePayment,
} from "./lib/sandboxFixtureResources";

const stripe = vi.hoisted(() => ({
  paymentIntents: { retrieve: vi.fn(), search: vi.fn(), create: vi.fn() },
  v2: { core: { accounts: { retrieve: vi.fn() } } },
}));
vi.mock("./lib/stripeClient", () => ({ getStripeClient: () => stripe }));
const catalog = vi.hoisted(() => ({
  listProducts: vi.fn(),
  listPricesByProduct: vi.fn(),
}));
vi.mock("./stripe", () => ({ stripe: catalog }));

function context() {
  const runQuery = vi.fn();
  const runMutation = vi.fn();
  const runAction = vi.fn();
  return {
    runQuery,
    runMutation,
    runAction,
    ctx: { runQuery, runMutation, runAction } as unknown as ActionCtx,
  };
}
const users = [
  { _id: "customer", role: "customer", stripeAccountId: "acct_customer" },
  { _id: "affiliate", role: "affiliate", stripeAccountId: "acct_affiliate" },
  ...["jordan", "maya", "sasha"].map((name) => ({
    _id: name,
    role: "seller",
    email: `${name}@example.com`,
    stripeAccountId: `acct_${name}`,
    name,
  })),
];

describe("sandbox resource retries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    catalog.listProducts.mockResolvedValue([
      { stripeProductId: "prod_maya", active: true },
    ]);
    catalog.listPricesByProduct.mockResolvedValue([
      {
        stripePriceId: "price_maya",
        stripeProductId: "prod_maya",
        active: true,
        currency: "usd",
        type: "one_time",
        unitAmount: 10000,
      },
    ]);
    stripe.v2.core.accounts.retrieve.mockResolvedValue({
      configuration: {
        recipient: {
          capabilities: {
            stripe_balance: { stripe_transfers: { status: "active" } },
          },
        },
      },
    });
  });
  it("binds fixture charges to their seller's catalog price before a dispute can prevent settlement", async () => {
    const { ctx, runQuery } = context();
    runQuery.mockResolvedValueOnce(users).mockResolvedValueOnce(null);
    stripe.paymentIntents.search.mockResolvedValue({ data: [] });
    stripe.paymentIntents.create.mockResolvedValue({ id: "pi_dispute" });
    await fixturePayment(
      ctx,
      "maya@example.com",
      "dispute:open",
      10000,
      "pm_card_createDispute",
      true,
    );
    expect(catalog.listProducts).toHaveBeenCalledWith(ctx, {
      accountId: "acct_maya",
    });
    expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          sellerId: "maya",
          stripePriceId: "price_maya",
          stripeProductId: "prod_maya",
        }),
      }),
      expect.anything(),
    );
  });
  it.each(["seller", "affiliate"])(
    "waits for %s transfer capabilities before creating a fixture payment",
    async (pending) => {
      const { ctx, runQuery, runMutation } = context();
      runQuery.mockResolvedValueOnce(users).mockResolvedValueOnce(null);
      stripe.paymentIntents.search.mockResolvedValue({ data: [] });
      stripe.paymentIntents.create.mockResolvedValue({ id: "pi_unready" });
      stripe.v2.core.accounts.retrieve.mockImplementation(
        async (id: string) => ({
          configuration: {
            recipient: {
              capabilities: {
                stripe_balance: {
                  stripe_transfers: {
                    status:
                      id ===
                      (pending === "seller" ? "acct_maya" : "acct_affiliate")
                        ? "pending"
                        : "active",
                  },
                },
              },
            },
          },
        }),
      );
      await expect(
        fixturePayment(
          ctx,
          "maya@example.com",
          "sale:0",
          10000,
          "pm_card_visa",
          true,
        ),
      ).rejects.toThrow("transfers are not ready yet");
      expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
      expect(runMutation).not.toHaveBeenCalled();
    },
  );
  it("retrieves a saved resource without recovering or creating it", async () => {
    const { ctx, runQuery, runMutation } = context();
    runQuery.mockResolvedValue("pi_saved");
    const retrieve = vi.fn().mockResolvedValue({ id: "pi_saved" });
    const recover = vi.fn();
    const create = vi.fn();
    expect(
      await ensure(ctx, "key", "payment", retrieve, recover, create),
    ).toEqual({ id: "pi_saved" });
    expect(retrieve).toHaveBeenCalledWith("pi_saved");
    expect(recover).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
  });
  it("recovers an existing Stripe object and saves its identity", async () => {
    const { ctx, runQuery, runMutation } = context();
    runQuery.mockResolvedValue(null);
    const create = vi.fn();
    await ensure(
      ctx,
      "key",
      "payment",
      vi.fn(),
      async () => ({ id: "pi_recovered" }),
      create,
    );
    expect(create).not.toHaveBeenCalled();
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      key: "key",
      kind: "payment",
      stripeId: "pi_recovered",
    });
  });
  it("creates and persists an object only when recovery finds nothing", async () => {
    const { ctx, runQuery, runMutation } = context();
    runQuery.mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue({ id: "pi_new" });
    await ensure(ctx, "key", "payment", vi.fn(), async () => undefined, create);
    expect(create).toHaveBeenCalledOnce();
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      key: "key",
      kind: "payment",
      stripeId: "pi_new",
    });
  });
  it("does not persist an identity when Stripe creation fails", async () => {
    const { ctx, runQuery, runMutation } = context();
    runQuery.mockResolvedValue(null);
    await expect(
      ensure(
        ctx,
        "key",
        "payment",
        vi.fn(),
        async () => undefined,
        async () => {
          throw new Error("Stripe unavailable");
        },
      ),
    ).rejects.toThrow("Stripe unavailable");
    expect(runMutation).not.toHaveBeenCalled();
  });
  it("requires linked customer, affiliate, and all seller accounts", async () => {
    const { ctx, runQuery } = context();
    for (const missing of users) {
      runQuery.mockResolvedValue(users.filter((user) => user !== missing));
      await expect(participants(ctx)).rejects.toThrow(
        "Seed demo users and linked Stripe accounts first.",
      );
    }
    runQuery.mockResolvedValue(users);
    expect((await participants(ctx)).sellers).toHaveLength(3);
  });
  it.each([true, false])(
    "settles a retry-safe fixture payment, referred=%s",
    async (referred) => {
      const { ctx, runQuery, runMutation, runAction } = context();
      runQuery.mockResolvedValueOnce(users).mockResolvedValueOnce(null);
      stripe.paymentIntents.search.mockResolvedValue({ data: [] });
      stripe.paymentIntents.create.mockResolvedValue({ id: "pi_fixture" });
      const result = await fixturePayment(
        ctx,
        "maya@example.com",
        "sale:1",
        10000,
        "pm_card_bypassPending",
        referred,
      );
      expect(result.payment.id).toBe("pi_fixture");
      expect(stripe.paymentIntents.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          amount: 10000,
          customer_account: "acct_customer",
          confirm: true,
          metadata: expect.objectContaining({
            sellerId: "maya",
            userId: "customer",
            affiliateAccountId: referred ? "acct_affiliate" : "",
            referralCode: referred ? "avery" : "",
          }),
        }),
        { idempotencyKey: result.key },
      );
      expect(runMutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ stripeId: "pi_fixture" }),
      );
      expect(runAction).toHaveBeenCalledWith(expect.anything(), {
        paymentIntentId: "pi_fixture",
      });
    },
  );
});
