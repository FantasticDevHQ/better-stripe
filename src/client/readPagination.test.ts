import { expect, it, vi } from "vitest";
import { BetterStripe } from "./index.js";
import { components } from "./setup.test.js";
it("forwards typed component cursors and account scope through public readers", async () => {
  const bs = new BetterStripe(components.betterStripe, {
    STRIPE_SECRET_KEY: "sk_test_reader_fixture",
  });
  const page = { page: [], isDone: true, continueCursor: "end" };
  const ctx = { runQuery: vi.fn().mockResolvedValue(page) };
  const paginationOpts = { numItems: 10, cursor: "opaque" };
  expect(
    await bs.paginatePayouts(ctx, {
      accountId: "acct_a",
      status: "paid",
      paginationOpts,
    }),
  ).toBe(page);
  expect(ctx.runQuery).toHaveBeenLastCalledWith(
    components.betterStripe.connect.queries.paginatePayouts,
    { accountId: "acct_a", status: "paid", paginationOpts },
  );
  expect(
    await bs.paginateProducts(ctx, {
      accountId: "acct_a",
      active: true,
      paginationOpts,
    }),
  ).toBe(page);
  expect(ctx.runQuery).toHaveBeenLastCalledWith(
    components.betterStripe.products.queries.paginateProducts,
    { accountId: "acct_a", active: true, paginationOpts },
  );
  expect(
    await bs.paginatePrices(ctx, {
      productId: "prod_a",
      active: false,
      paginationOpts,
    }),
  ).toBe(page);
  expect(ctx.runQuery).toHaveBeenLastCalledWith(
    components.betterStripe.products.queries.paginatePrices,
    { productId: "prod_a", active: false, paginationOpts },
  );
});
it("forwards exact currency summary reads through the public client", async () => {
  const bs = new BetterStripe(components.betterStripe);
  const ctx = { runQuery: vi.fn().mockResolvedValue({ totals: [] }) };
  expect(
    await bs.getAccountEarningsByCurrency(ctx, {
      destinationAccountId: "acct_a",
    }),
  ).toEqual({ totals: [] });
  expect(ctx.runQuery).toHaveBeenLastCalledWith(
    components.betterStripe.connect.queries.getAccountEarningsByCurrency,
    { destinationAccountId: "acct_a" },
  );
  await bs.getAccountPayoutsByCurrency(ctx, { accountId: "acct_a" });
  expect(ctx.runQuery).toHaveBeenLastCalledWith(
    components.betterStripe.connect.queries.getAccountPayoutsByCurrency,
    { accountId: "acct_a" },
  );
});
