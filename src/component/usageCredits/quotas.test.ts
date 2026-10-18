import { makeFunctionReference } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";
import { setupCredits } from "./accounting.fixtures.js";
const ref = (name: string) =>
  makeFunctionReference<"mutation">(`usageCredits/mutations:${name}`);
afterEach(() => vi.useRealTimers());
it("accepts the 1000th retained purchase, preserves replay and rejects 1001 without writing", async () => {
  const { t, purchase } = await setupCredits();
  await t.run(async (ctx) => {
    const row = (await ctx.db.query("usageCreditAccounts").first())!;
    await ctx.db.patch(row._id, { purchaseCount: 999 });
  });
  const inputJson = JSON.stringify({
    ...purchase,
    purchaseId: "last_retained",
  });
  const last = await t.mutation(ref("preparePurchase"), { inputJson });
  expect(await t.mutation(ref("preparePurchase"), { inputJson })).toEqual(last);
  await expect(
    t.mutation(ref("preparePurchase"), {
      inputJson: JSON.stringify({ ...purchase, purchaseId: "over_retained" }),
    }),
  ).rejects.toThrow(/purchase quota/i);
  await t.run(async (ctx) => {
    expect(await ctx.db.query("usageCreditAccounts").first()).toMatchObject({
      purchaseCount: 1000,
    });
    expect(await ctx.db.query("usageCreditPurchases").take(3)).toHaveLength(2);
  });
});
it("commits the 100000th credit audit entry and rolls back the next reservation", async () => {
  const { t, event, subscription } = await setupCredits();
  await t.run(async (ctx) => {
    const row = (await ctx.db.query("usageCreditAccounts").first())!;
    await ctx.db.patch(row._id, { historyCount: 99999 });
  });
  const args = {
    inputJson: JSON.stringify({ ...event, quantity: "1" }),
    subscriptionJson: JSON.stringify(subscription),
  };
  const last = await t.mutation(ref("reserve"), args);
  expect(await t.mutation(ref("reserve"), args)).toEqual(last);
  await expect(
    t.mutation(ref("reserve"), {
      ...args,
      inputJson: JSON.stringify({
        ...event,
        quantity: "1",
        sourceEventId: "over_retained",
      }),
    }),
  ).rejects.toThrow(/history.*quota/i);
  await t.run(async (ctx) => {
    expect(await ctx.db.query("usageCreditAccounts").first()).toMatchObject({
      historyCount: 100000,
    });
    expect(await ctx.db.query("usageReservations").take(2)).toHaveLength(1);
    expect(await ctx.db.query("usageCreditGrants").first()).toMatchObject({
      available: "9",
      reserved: "1",
    });
  });
});
