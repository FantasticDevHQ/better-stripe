// @vitest-environment edge-runtime
import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { components, initConvexTest } from "../setup.test.js";
import schema from "../../component/schema.js";
import * as accounts from "./accounts.js";

const modules = import.meta.glob("../../component/**/*.{ts,js,tsx,jsx}");
function setup() {
  const t = initConvexTest();
  t.registerComponent("betterStripe", schema, modules);
  const component = components.betterStripe as unknown as Component;
  const ctx = {
    runQuery: (ref: any, args: any) => t.query(ref, args),
    runMutation: (ref: any, args: any) => t.mutation(ref, args),
  } as RunCtx;
  const update = vi.fn().mockResolvedValue({});
  const retrieve = vi.fn().mockResolvedValue({
    id: "acct_merchant",
    applied_configurations: ["recipient", "merchant"],
  });
  const stripe = {
    v2: { core: { accounts: { update, retrieve } } },
  } as unknown as Stripe;
  return { t, component, ctx, stripe, update, retrieve };
}

describe("merchant configuration", () => {
  it("requests card payments and persists only the target account without changing ownership", async () => {
    const { t, component, ctx, stripe, update, retrieve } = setup();
    for (const stripeAccountId of ["acct_merchant", "acct_other"]) {
      await t.mutation(component.core.mutations.upsertAccount, {
        stripeAccountId,
        userId: "owner",
        orgId: "org",
        appliedConfigurations: ["recipient"],
      });
    }
    expect(typeof accounts.addMerchantConfiguration).toBe("function");
    const result = await accounts.addMerchantConfiguration(
      stripe,
      component,
      ctx,
      { stripeAccountId: "acct_merchant" },
    );
    expect(result).toEqual({
      success: true,
      appliedConfigurations: ["recipient", "merchant"],
    });
    expect(update).toHaveBeenCalledWith("acct_merchant", {
      configuration: {
        merchant: { capabilities: { card_payments: { requested: true } } },
      },
    });
    expect(retrieve).toHaveBeenCalledWith("acct_merchant");
    expect(
      await t.query(component.core.queries.getAccountByStripeId, {
        stripeAccountId: "acct_merchant",
      }),
    ).toMatchObject({
      userId: "owner",
      orgId: "org",
      appliedConfigurations: ["recipient", "merchant"],
    });
    expect(
      await t.query(component.core.queries.getAccountByStripeId, {
        stripeAccountId: "acct_other",
      }),
    ).toMatchObject({ appliedConfigurations: ["recipient"] });
  });

  it("rejects missing component ownership before provider mutation", async () => {
    const { component, ctx, stripe, update } = setup();
    expect(typeof accounts.addMerchantConfiguration).toBe("function");
    await expect(
      accounts.addMerchantConfiguration(stripe, component, ctx, {
        stripeAccountId: "acct_missing",
      }),
    ).rejects.toMatchObject({ data: { code: "ACCOUNT_NOT_FOUND" } });
    expect(update).not.toHaveBeenCalled();
  });

  it("propagates failed readback and recovers on retry with provider configurations", async () => {
    const { t, component, ctx, stripe, retrieve } = setup();
    await t.mutation(component.core.mutations.upsertAccount, {
      stripeAccountId: "acct_merchant",
      userId: "owner",
      appliedConfigurations: ["recipient"],
    });
    retrieve.mockRejectedValueOnce(new Error("readback unavailable"));
    expect(typeof accounts.addMerchantConfiguration).toBe("function");
    await expect(
      accounts.addMerchantConfiguration(stripe, component, ctx, {
        stripeAccountId: "acct_merchant",
      }),
    ).rejects.toThrow("readback unavailable");
    expect(
      await t.query(component.core.queries.getAccountByStripeId, {
        stripeAccountId: "acct_merchant",
      }),
    ).toMatchObject({ appliedConfigurations: ["recipient"] });
    await accounts.addMerchantConfiguration(stripe, component, ctx, {
      stripeAccountId: "acct_merchant",
    });
    expect(
      await t.query(component.core.queries.getAccountByStripeId, {
        stripeAccountId: "acct_merchant",
      }),
    ).toMatchObject({ appliedConfigurations: ["recipient", "merchant"] });
  });
});

describe("transfer capability", () => {
  it("accepts active V2 recipient transfers and V1 transfers", () => {
    expect(typeof accounts.canReceiveTransfers).toBe("function");
    expect(
      accounts.canReceiveTransfers({
        configuration: {
          recipient: {
            capabilities: {
              stripe_balance: { stripe_transfers: { status: "active" } },
            },
          },
        },
      }),
    ).toBe(true);
    expect(
      accounts.canReceiveTransfers({ capabilities: { transfers: "active" } }),
    ).toBe(true);
  });
  it.each([
    null,
    undefined,
    {},
    { capabilities: { transfers: "pending" } },
    { configuration: { recipient: null } },
    {
      configuration: {
        recipient: {
          capabilities: {
            stripe_balance: { stripe_transfers: { status: "inactive" } },
          },
        },
      },
    },
  ])("rejects absent or unready capability %#", (account) => {
    expect(typeof accounts.canReceiveTransfers).toBe("function");
    expect(accounts.canReceiveTransfers(account)).toBe(false);
  });
});
