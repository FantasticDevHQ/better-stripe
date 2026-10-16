import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

it("explicitly opts new demo stores into referral commissions without changing real defaults or later edits", async () => {
  const t = convexTest(schema, import.meta.glob("./**/*.*s"));
  await t.mutation(internal.seed.seedMarketplaceDb, {});
  const sellers = await t.run(async (ctx) => {
    const users = await ctx.db.query("users").take(10);
    return users.filter((user) => user.role === "seller");
  });
  expect(sellers).toHaveLength(2);
  for (const seller of sellers) {
    const rate = await t.query(api.affiliateDefaults.get, {
      sellerId: seller._id,
    });
    expect(rate.effectiveBasisPoints).toBe(2000);
    const row = await t.run((ctx) =>
      ctx.db
        .query("affiliateDefaults")
        .withIndex("by_seller", (q) => q.eq("sellerId", seller._id))
        .unique(),
    );
    expect(row?.affiliateCommissionTerm).toBe("forever");
    await t.run((ctx) =>
      ctx.db.patch("affiliateDefaults", row!._id, {
        affiliateBasisPoints: 0,
        version: 2,
      }),
    );
  }
  await t.mutation(internal.seed.seedMarketplaceDb, {});
  for (const seller of sellers)
    expect(
      (await t.query(api.affiliateDefaults.get, { sellerId: seller._id }))
        .effectiveBasisPoints,
    ).toBe(0);
  const ordinarySeller = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Ordinary seller",
      email: "ordinary@example.com",
      role: "seller",
    }),
  );
  expect(
    (await t.query(api.affiliateDefaults.get, { sellerId: ordinarySeller }))
      .effectiveBasisPoints,
  ).toBe(0);
});
