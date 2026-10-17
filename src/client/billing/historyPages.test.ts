import { expect, it, vi } from "vitest";
import { components } from "../setup.test.js";
import { ReadContractClient } from "../readContracts.js";

it("exposes both independent bounded billing history readers on the public client", () => {
  expect(ReadContractClient.prototype).toHaveProperty(
    "paginateSubscriptions",
    expect.any(Function),
  );
  expect(ReadContractClient.prototype).toHaveProperty(
    "paginateCheckoutSessions",
    expect.any(Function),
  );
});

it("forwards the original buyer/account and independent cursors without provider operations", async () => {
  const client = new ReadContractClient(components.betterStripe);
  const result = { page: [], isDone: true, continueCursor: "original_cursor" };
  const runQuery = vi.fn().mockResolvedValue(result);
  const ctx = { runQuery };
  const subscriptions = {
    userId: "original_buyer",
    accountId: "acct_original",
    status: "trialing" as const,
    paginationOpts: { cursor: "subscription_cursor", numItems: 17 },
  };
  const sessions = {
    userId: "original_buyer",
    status: "complete" as const,
    paginationOpts: { cursor: "checkout_cursor", numItems: 19 },
  };
  expect(await client.paginateSubscriptions(ctx, subscriptions)).toBe(result);
  expect(await client.paginateCheckoutSessions(ctx, sessions)).toBe(result);
  expect(runQuery).toHaveBeenNthCalledWith(
    1,
    components.betterStripe.billingHistory.queries.paginateSubscriptions,
    subscriptions,
  );
  expect(runQuery).toHaveBeenNthCalledWith(
    2,
    components.betterStripe.billingHistory.queries.paginateCheckoutSessions,
    sessions,
  );
});

it("propagates component read errors without returning an empty success page", async () => {
  const client = new ReadContractClient(components.betterStripe);
  const runQuery = vi.fn().mockRejectedValue(new Error("read failed"));
  await expect(
    client.paginateSubscriptions(
      { runQuery },
      {
        userId: "original",
        paginationOpts: { cursor: null, numItems: 10 },
      },
    ),
  ).rejects.toThrow("read failed");
});
