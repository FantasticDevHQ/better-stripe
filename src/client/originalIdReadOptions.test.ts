import { expect, it, vi } from "vitest";
import { BetterStripe } from "./index.js";
import { components } from "./setup.test.js";
import type {
  AccountByStripeIdOptions,
  SubscriptionByStripeIdOptions,
} from "./publicTypes.js";

it.each([undefined, false, true])(
  "forwards requireUnique=%s unchanged through both public SDK methods",
  async (requireUnique) => {
    const client = new BetterStripe(components.betterStripe);
    const row = { observed: true };
    const runQuery = vi.fn().mockResolvedValue(row);
    const account: AccountByStripeIdOptions = {
      stripeAccountId: "acct_original",
      ...(requireUnique === undefined ? {} : { requireUnique }),
    };
    const subscription: SubscriptionByStripeIdOptions = {
      stripeSubscriptionId: "sub_original",
      ...(requireUnique === undefined ? {} : { requireUnique }),
    };
    expect(await client.getAccountByStripeId({ runQuery }, account)).toBe(row);
    expect(
      await client.getSubscriptionByStripeId({ runQuery }, subscription),
    ).toBe(row);
    expect(runQuery).toHaveBeenNthCalledWith(
      1,
      components.betterStripe.core.queries.getAccountByStripeId,
      account,
    );
    expect(runQuery).toHaveBeenNthCalledWith(
      2,
      components.betterStripe.billing.queries.getSubscriptionByStripeId,
      subscription,
    );
  },
);

it("propagates unique-read failures without inventing missing records", async () => {
  const client = new BetterStripe(components.betterStripe);
  const runQuery = vi
    .fn()
    .mockRejectedValue(new Error("component unavailable"));
  await expect(
    client.getAccountByStripeId(
      { runQuery },
      {
        stripeAccountId: "acct_original",
        requireUnique: true,
      },
    ),
  ).rejects.toThrow("component unavailable");
  await expect(
    client.getSubscriptionByStripeId(
      { runQuery },
      {
        stripeSubscriptionId: "sub_original",
        requireUnique: true,
      },
    ),
  ).rejects.toThrow("component unavailable");
});
